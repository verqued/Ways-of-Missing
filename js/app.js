(function (global) {
  "use strict";

  if ("scrollRestoration" in global.history) {
    global.history.scrollRestoration = "manual";
  }

  function forceOpeningSlide() {
    document.documentElement.classList.remove("cover-intro-complete");
    global.scrollTo(0, 0);
  }

  forceOpeningSlide();
  global.addEventListener("pageshow", forceOpeningSlide);

  function startApp() {
    forceOpeningSlide();
    var config = global.APP_CONFIG;
    if (!config) {
      throw new Error("필수 설정을 불러오지 못했습니다.");
    }
    var slideData = [];
    for (var slideNumber = 1; slideNumber <= config.source.slideCount; slideNumber += 1) {
      slideData.push(global["SLIDE" + slideNumber + "_WORD_DATA"]);
    }
    var coverData = global.COVER_WORD_DATA;
    if (!global.WordSlide || !coverData || slideData.some(function (data) { return !data; })) {
      throw new Error("슬라이드 벡터 데이터를 불러오지 못했습니다.");
    }

    function cloneRuntimeSlideData(data) {
      var runtimeData = {};
      Object.keys(data).forEach(function (key) { runtimeData[key] = data[key]; });
      runtimeData.markerRegions = data.markerRegions.map(function (region) {
        var runtimeRegion = {};
        Object.keys(region).forEach(function (key) { runtimeRegion[key] = region[key]; });
        return runtimeRegion;
      });
      return runtimeData;
    }

    var slidesRoot = document.querySelector("#slides");
    var coverSection = document.querySelector("#slide-cover");
    var loopCoverSection = coverSection.cloneNode(false);
    loopCoverSection.removeAttribute("id");
    loopCoverSection.classList.add("loop-cover-buffer");
    loopCoverSection.dataset.loopBuffer = "cover";
    loopCoverSection.setAttribute("aria-hidden", "true");
    slidesRoot.appendChild(loopCoverSection);

    var primaryMountedSlides = [new global.WordSlide(
      coverSection,
      cloneRuntimeSlideData(coverData)
    ).mount()].concat(slideData.map(function (data, index) {
      return new global.WordSlide(
        document.querySelector("#slide-" + (index + 1)),
        cloneRuntimeSlideData(data)
      ).mount();
    }));
    var loopCoverSlide = new global.WordSlide(
      loopCoverSection,
      cloneRuntimeSlideData(coverData)
    ).mount();
    var mountedSlides = primaryMountedSlides.concat([loopCoverSlide]);
    var wordSlide = mountedSlides[1];
    var history = [];
    var lastBlinkAt = -Infinity;
    var lastScrollY = global.scrollY || 0;
    var blinkFlash = document.createElement("div");
    blinkFlash.className = "blink-flash";
    blinkFlash.setAttribute("aria-hidden", "true");
    document.body.appendChild(blinkFlash);
    var blinkFlashTimer = 0;
    var idleOmissionPrompt = document.querySelector("#idle-omission-prompt");
    var idleOmissionPromptTimer = 0;
    var exhaustedOmissionStartedAt = 0;
    var lastExhaustedBlinkAt = -Infinity;
    var exhaustedBlinkCount = 0;

    var gate = document.querySelector("#camera-gate");
    var startButton = document.querySelector("#camera-start");
    var cameraHud = document.querySelector("#camera-hud");
    var video = document.querySelector("#camera-video");
    var eyeOpenDuration = document.querySelector("#eye-open-duration");
    var omissionLevel = document.querySelector("#omission-level");
    var omissionAction = document.querySelector("#omission-action");
    var detector = config.interaction.cameraEnabled ? new global.BlinkDetector(config) : null;
    var cameraPermissionGranted = false;
    var cameraRequestSequence = 0;
    var controlledScrollTarget = global.scrollY || 0;
    var controlledScrollFrame = 0;
    var furthestScrollY = global.scrollY || 0;
    var eyeTimerStartedAt = 0;
    var eyeTimerFrame = 0;
    var lastScrollInputAt = global.performance.now();
    var loopBoundaryY = Infinity;
    var loopRepositioning = false;

    function isGuidelineVisible() {
      return gate && !gate.hidden
        && !gate.classList.contains("is-leaving")
        && !document.body.classList.contains("presentation-ui-hidden");
    }

    function refreshLoopBoundary() {
      loopBoundaryY = loopCoverSection.offsetTop;
    }

    function wrapForwardLoop(scrollY) {
      if (loopRepositioning || !isFinite(loopBoundaryY) || scrollY < loopBoundaryY) return false;
      var wrappedOffset = Math.max(0, scrollY - loopBoundaryY);
      var wrappedTargetOffset = Math.max(0, controlledScrollTarget - loopBoundaryY);
      document.documentElement.classList.add("cover-intro-complete");
      refreshLoopBoundary();
      var coverY = coverSection.offsetTop;
      var wrappedY = coverY + wrappedOffset;
      var wrappedTarget = coverY + wrappedTargetOffset;
      loopRepositioning = true;
      primaryMountedSlides.forEach(function (slide) { slide.reset(); });
      global.WordSlide.voiceReadyAt = 0;
      global.WordSlide.lastScrollY = wrappedY;
      global.WordSlide.scrollDirection = 1;
      global.WordSlide.omissionScrollInput = 0;
      history.length = 0;
      controlledScrollTarget = Math.max(wrappedY, wrappedTarget);
      furthestScrollY = wrappedY;
      lastScrollY = wrappedY;
      global.scrollTo(0, wrappedY);
      primaryMountedSlides.forEach(function (slide) { slide.updateScrollMotion(); });
      global.requestAnimationFrame(function () {
        loopCoverSlide.reset();
        loopCoverSlide.requestScrollUpdate();
        loopRepositioning = false;
      });
      return true;
    }

    refreshLoopBoundary();

    function clampScrollTarget(value) {
      var maximum = Math.max(0, document.documentElement.scrollHeight - global.innerHeight);
      return Math.max(0, Math.min(maximum, value));
    }

    function animateControlledScroll() {
      controlledScrollFrame = 0;
      if (isGuidelineVisible()) return;
      var current = global.scrollY || 0;
      if (wrapForwardLoop(current)) {
        controlledScrollFrame = global.requestAnimationFrame(animateControlledScroll);
        return;
      }
      var distance = controlledScrollTarget - current;
      if (Math.abs(distance) < 0.5) {
        global.scrollTo(0, controlledScrollTarget);
        return;
      }
      var maximumFrameStep = Math.min(28, Math.max(12, global.innerHeight * 0.032));
      var frameStep = Math.max(-maximumFrameStep, Math.min(maximumFrameStep, distance * 0.18));
      global.scrollTo(0, current + frameStep);
      controlledScrollFrame = global.requestAnimationFrame(animateControlledScroll);
    }

    function requestControlledScroll(delta) {
      if (isGuidelineVisible()) return;
      if (delta <= 0) return;
      var current = global.scrollY || 0;
      var maximumBacklog = Math.min(210, Math.max(120, global.innerHeight * 0.22));
      var softenedDelta = Math.tanh(delta / 100) * 34;
      var requestedTarget = controlledScrollTarget + softenedDelta;
      controlledScrollTarget = clampScrollTarget(Math.min(current + maximumBacklog, requestedTarget));
      if (!controlledScrollFrame) controlledScrollFrame = global.requestAnimationFrame(animateControlledScroll);
    }

    function handleControlledWheel(event) {
      event.preventDefault();
      if (isGuidelineVisible()) return;
      lastScrollInputAt = global.performance.now();
      var unit = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? global.innerHeight : 1);
      if (global.WordSlide && global.WordSlide.noteOmissionScroll) {
        global.WordSlide.noteOmissionScroll(Math.max(-110, Math.min(110, event.deltaY * unit)));
      }
      requestControlledScroll(event.deltaY * unit);
    }
    if (!config.interaction.cameraEnabled) {
      gate.hidden = true;
      cameraHud.hidden = true;
    } else {
      gate.hidden = false;
    }

    function omissionLevelFor(durationMs) {
      if (durationMs < config.blink.characterOmissionMaxMs) return "character";
      if (durationMs < config.blink.wordOmissionMaxMs) return "word";
      if (durationMs < config.blink.sentenceOmissionMaxMs) return "sentence";
      if (durationMs < config.blink.paragraphOmissionMinMs) return "sentences";
      return "paragraph";
    }

    function updateEyeOpenMeter(durationMs) {
      var level = omissionLevelFor(durationMs);
      eyeOpenDuration.textContent = (durationMs / 1000).toFixed(1) + "초";
      omissionLevel.textContent = level === "character" ? "글자 생략"
        : (level === "word" ? "단어 생략"
          : (level === "sentence" ? "문장 생략"
            : (level === "sentences" ? "연속 문장 생략" : "문단 생략")));
      omissionAction.textContent = level === "character" ? "글자 1개 생략"
        : (level === "word" ? "단어 1개 생략"
          : (level === "sentence" ? "현재 문장 묶음 1개 생략"
            : (level === "sentences" ? "현재부터 문장 묶음 2개 생략"
              : "현재부터 묶음 " + config.blink.paragraphGroupCount + "개 생략")));
    }

    function animateEyeOpenMeter(timestamp) {
      if (!eyeTimerStartedAt) eyeTimerStartedAt = timestamp;
      updateEyeOpenMeter(Math.max(0, timestamp - eyeTimerStartedAt));
      eyeTimerFrame = global.requestAnimationFrame(animateEyeOpenMeter);
    }

    function resetEyeOpenMeter(timestamp) {
      eyeTimerStartedAt = timestamp || global.performance.now();
      updateEyeOpenMeter(0);
    }

    function playBlinkFlash() {
      global.clearTimeout(blinkFlashTimer);
      blinkFlash.classList.remove("is-active");
      void blinkFlash.offsetWidth;
      blinkFlash.classList.add("is-active");
      blinkFlashTimer = global.setTimeout(function () {
        blinkFlash.classList.remove("is-active");
      }, 210);
    }

    function hideIdleOmissionPrompt() {
      if (!idleOmissionPrompt) return;
      idleOmissionPrompt.classList.remove("is-visible");
      idleOmissionPrompt.hidden = true;
    }

    function scheduleIdleOmissionPrompt() {
      global.clearTimeout(idleOmissionPromptTimer);
      idleOmissionPromptTimer = 0;
      if (!detector || !detector.running || isGuidelineVisible()
          || !exhaustedOmissionStartedAt || exhaustedBlinkCount < 2) return;
      var delay = config.interaction.idleOmissionPromptDelayMs;
      var exhaustedFor = global.performance.now() - exhaustedOmissionStartedAt;
      idleOmissionPromptTimer = global.setTimeout(function checkIdleOmissionPrompt() {
        idleOmissionPromptTimer = 0;
        if (!detector || !detector.running || isGuidelineVisible()) return;
        var now = global.performance.now();
        var currentExhaustedFor = now - exhaustedOmissionStartedAt;
        if (currentExhaustedFor < delay) {
          scheduleIdleOmissionPrompt();
          return;
        }
        if (now - lastExhaustedBlinkAt > 8000) return;
        idleOmissionPrompt.hidden = false;
        void idleOmissionPrompt.offsetWidth;
        idleOmissionPrompt.classList.add("is-visible");
      }, Math.max(0, delay - exhaustedFor));
    }

    function resetExhaustedOmissionPrompt() {
      exhaustedOmissionStartedAt = 0;
      lastExhaustedBlinkAt = -Infinity;
      exhaustedBlinkCount = 0;
      global.clearTimeout(idleOmissionPromptTimer);
      idleOmissionPromptTimer = 0;
      hideIdleOmissionPrompt();
    }

    function noteIdleOmissionActivity() {
      resetExhaustedOmissionPrompt();
    }

    function noteExhaustedBlink(timestamp) {
      if (!exhaustedOmissionStartedAt) exhaustedOmissionStartedAt = timestamp;
      lastExhaustedBlinkAt = timestamp;
      exhaustedBlinkCount += 1;
      scheduleIdleOmissionPrompt();
    }

    function applyBlink(timestamp, openDurationMs) {
      if (isGuidelineVisible()) return;
      if (!config.interaction.blinkOmissionEnabled) return;
      playBlinkFlash();
      if (timestamp - lastBlinkAt < config.blink.contentCooldownMs) return;
      resetEyeOpenMeter(timestamp);
      var focus = global.WordSlide.getExclusiveFocus();
      var allowIncomplete = timestamp - lastScrollInputAt >= config.blink.incompleteOmissionAfterIdleMs;
      var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
      var visibleTargets = global.WordSlide.instances.map(function (slide) {
        var target = slide.findClosestVisibleCompletedGroup(allowIncomplete);
        if (!target) return null;
        if (focus && focus.slide === slide
            && (allowIncomplete || slide.isGroupFullyRevealed(focus.regionIndex))
            && slide.hasVisibleOmittableContent(focus.regionIndex, allowIncomplete)) {
          target = { groupIndex: focus.regionIndex, distance: 0, center: viewportHeight * 0.55 };
        }
        return { slide: slide, groupIndex: target.groupIndex, distance: target.distance };
      }).filter(Boolean).sort(function (first, second) {
        return first.distance - second.distance;
      });
      if (!visibleTargets.length) {
        noteExhaustedBlink(timestamp);
        return;
      }
      var activeSlide = visibleTargets[0].slide;
      var groupIndex = visibleTargets[0].groupIndex;
      var level = omissionLevelFor(openDurationMs || 0);
      var omission = activeSlide.omitAtGroup(
        groupIndex,
        level,
        config.blink.paragraphGroupCount,
        allowIncomplete
      );
      if (!omission) {
        noteExhaustedBlink(timestamp);
        return;
      }
      resetExhaustedOmissionPrompt();
      omission.appliedAtY = global.scrollY || 0;
      history.push(omission);
      lastBlinkAt = timestamp;
    }

    function handleScroll() {
      var scrollY = global.scrollY || 0;
      if (scrollY !== lastScrollY) noteIdleOmissionActivity(global.performance.now());
      if (loopRepositioning) {
        furthestScrollY = scrollY;
        lastScrollY = scrollY;
        return;
      }
      if (wrapForwardLoop(scrollY)) return;
      if (scrollY < furthestScrollY) {
        controlledScrollTarget = furthestScrollY;
        global.scrollTo(0, furthestScrollY);
        return;
      }
      furthestScrollY = scrollY;
      if (!controlledScrollFrame) controlledScrollTarget = scrollY;
      lastScrollY = scrollY;
    }

    function setCameraButtonLabel(label) {
      var labelElement = startButton.querySelector("span");
      if (!labelElement) {
        labelElement = document.createElement("span");
        startButton.replaceChildren(labelElement);
      }
      labelElement.textContent = label;
    }

    async function startExperience() {
      if (!detector) return;
      var requestSequence = ++cameraRequestSequence;
      var requestDetector = new global.BlinkDetector(config);
      startButton.disabled = true;
      gate.classList.add("is-camera-loading");
      setCameraButtonLabel("카메라 허용 중…");
      try {
        await requestDetector.start(video, {
          onBlink: function (event) { applyBlink(event.timestamp, event.openDurationMs); },
        });
        if (requestSequence !== cameraRequestSequence) {
          requestDetector.stop();
          return;
        }
        if (detector !== requestDetector) detector.stop();
        detector = requestDetector;
        cameraHud.hidden = false;
        resetEyeOpenMeter(global.performance.now());
        if (!eyeTimerFrame) eyeTimerFrame = global.requestAnimationFrame(animateEyeOpenMeter);
        setCameraButtonLabel("카메라 허용됨.");
        gate.classList.remove("is-camera-loading");
        gate.classList.add("is-camera-allowed");
        cameraPermissionGranted = true;
        noteIdleOmissionActivity(global.performance.now());
      } catch (error) {
        requestDetector.stop();
        if (requestSequence !== cameraRequestSequence) return;
        cameraPermissionGranted = false;
        startButton.disabled = false;
        gate.classList.remove("is-camera-loading");
        setCameraButtonLabel("카메라 허용");
      }
    }

    if (detector) startButton.addEventListener("click", startExperience);

    function restoreCameraRetryButton() {
      if (cameraPermissionGranted || !startButton.disabled
          || !gate.classList.contains("is-camera-loading")) return;
      startButton.disabled = false;
      gate.classList.remove("is-camera-loading");
      setCameraButtonLabel("카메라 허용");
    }

    global.addEventListener("focus", function () {
      global.setTimeout(restoreCameraRetryButton, 80);
    });
    gate.addEventListener("pointerdown", function (event) {
      if (!startButton.contains(event.target)) restoreCameraRetryButton();
    });

    var presentationUiDismissed = false;

    global.addEventListener("keydown", function (event) {
      var target = event.target;
      var isTyping = target && (
        target.isContentEditable
        || target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
      );
      if (!isTyping && (event.key === "q" || event.key === "Q" || event.key === "ㅂ")) {
        event.preventDefault();
        if (!cameraPermissionGranted) return;
        if (!presentationUiDismissed) {
          presentationUiDismissed = true;
          document.body.classList.add("presentation-ui-hidden");
          noteIdleOmissionActivity(global.performance.now());
        }
        return;
      }
      if (!isTyping && isGuidelineVisible()) {
        if (/^[0-9]$/.test(event.key) || event.key === "b" || event.key === "B"
            || event.key === "ArrowDown" || event.key === "ArrowUp"
            || event.key === "PageDown" || event.key === "PageUp" || event.key === " ") {
          event.preventDefault();
        }
        return;
      }
      if (event.key === "b" || event.key === "B") {
        applyBlink(performance.now(), 0);
      }
      var controlledKeys = {
        ArrowDown: 90,
        ArrowUp: -90,
        PageDown: global.innerHeight * 0.8,
        PageUp: global.innerHeight * -0.8,
        " ": event.shiftKey ? global.innerHeight * -0.8 : global.innerHeight * 0.8
      };
      if (Object.prototype.hasOwnProperty.call(controlledKeys, event.key)) {
        event.preventDefault();
        lastScrollInputAt = global.performance.now();
        noteIdleOmissionActivity(lastScrollInputAt);
        requestControlledScroll(controlledKeys[event.key]);
      }
    });
    global.addEventListener("wheel", function (event) {
      noteIdleOmissionActivity(global.performance.now());
      handleControlledWheel(event);
    }, { passive: false });
    global.addEventListener("touchstart", function () {
      lastScrollInputAt = global.performance.now();
      noteIdleOmissionActivity(lastScrollInputAt);
    }, { passive: true });
    global.addEventListener("touchmove", function (event) {
      if (isGuidelineVisible()) event.preventDefault();
    }, { passive: false });
    global.addEventListener("touchmove", function () {
      lastScrollInputAt = global.performance.now();
      noteIdleOmissionActivity(lastScrollInputAt);
    }, { passive: true });
    global.addEventListener("scroll", handleScroll, { passive: true });
    global.addEventListener("resize", refreshLoopBoundary, { passive: true });
    global.addEventListener("load", refreshLoopBoundary, { once: true });
    global.addEventListener("beforeunload", function () {
      if (detector) detector.stop();
      global.cancelAnimationFrame(eyeTimerFrame);
      global.clearTimeout(idleOmissionPromptTimer);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, { once: true });
  } else {
    startApp();
  }
}(window));
