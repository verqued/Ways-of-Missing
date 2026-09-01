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
    loopCoverSection.classList.add("is-loop-cover-pending");
    loopCoverSection.dataset.loopBuffer = "cover";
    loopCoverSection.setAttribute("aria-hidden", "true");
    slidesRoot.appendChild(loopCoverSection);

    var primaryMountedSlides = [new global.WordSlide(
      coverSection,
      cloneRuntimeSlideData(coverData)
    )].concat(slideData.map(function (data, index) {
      return new global.WordSlide(
        document.querySelector("#slide-" + (index + 1)),
        cloneRuntimeSlideData(data)
      );
    }));
    var loopCoverSlide = new global.WordSlide(
      loopCoverSection,
      cloneRuntimeSlideData(coverData)
    );
    var virtualSlideFrame = 0;

    function shouldMountSlide(slide, lookAheadPx, lookBehindPx) {
      if (!slide || !slide.section) return false;
      var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
      var rect = slide.section.getBoundingClientRect();
      return rect.bottom > -lookBehindPx && rect.top < viewportHeight + lookAheadPx;
    }

    function applyVirtualSlideWindow() {
      virtualSlideFrame = 0;
      var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
      // Warm two viewports ahead so hundreds of SVG units have enough time to
      // load and decode on slower exhibition hardware. Retaining only half a
      // viewport behind also prevents overflow artwork from disappearing at a
      // section boundary without keeping old slides indefinitely.
      var lookAheadPx = viewportHeight * 2;
      var lookBehindPx = viewportHeight * 0.5;
      primaryMountedSlides.forEach(function (slide) {
        var forceCover = coverPuzzleRunning && slide === primaryMountedSlides[0];
        if (forceCover || shouldMountSlide(slide, lookAheadPx, lookBehindPx)) {
          slide.mount();
          slide.requestScrollUpdate();
        } else {
          slide.unmount();
        }
      });
      var forceLoopCover = coverPuzzleRunning || loopRepositioning;
      if (forceLoopCover || shouldMountSlide(loopCoverSlide, lookAheadPx, lookBehindPx)) {
        loopCoverSlide.mount();
        loopCoverSlide.requestScrollUpdate();
      } else {
        loopCoverSlide.unmount();
      }
    }

    function updateVirtualSlideWindow(force) {
      if (force) {
        global.cancelAnimationFrame(virtualSlideFrame);
        virtualSlideFrame = 0;
        applyVirtualSlideWindow();
        return;
      }
      if (virtualSlideFrame) return;
      virtualSlideFrame = global.requestAnimationFrame(applyVirtualSlideWindow);
    }

    updateVirtualSlideWindow(true);
    var wordSlide = primaryMountedSlides[1];
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
    var idleOmissionQuietStartedAt = 0;
    var idleOmissionCheckIntervalMs = 200;

    var gate = document.querySelector("#camera-gate");
    var startButton = document.querySelector("#camera-start");
    var mobileGuideDismiss = document.querySelector("#mobile-guide-dismiss");
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
    var coverPuzzleRunning = false;
    var coverPuzzleTimer = 0;

    function playCoverPuzzle(slide, onComplete) {
      if (!slide || !slide.groups || !slide.groups[0] || coverPuzzleRunning) return false;
      var pieces = slide.groups[0];
      if (!pieces.length) return false;
      coverPuzzleRunning = true;
      if (slide.section) slide.section.classList.remove("is-loop-cover-pending");
      document.documentElement.classList.add("cover-puzzle-lock");
      global.cancelAnimationFrame(controlledScrollFrame);
      controlledScrollFrame = 0;
      controlledScrollTarget = global.scrollY || 0;
      pieces.forEach(function (piece, index) {
        var direction = index % 4;
        var horizontalDistance = 36 + index % 5 * 7;
        var verticalDistance = 31 + index % 5 * 6;
        var horizontal = direction === 0 ? -horizontalDistance
          : (direction === 1 ? horizontalDistance : 0);
        var vertical = direction === 2 ? -verticalDistance
          : (direction === 3 ? verticalDistance : 0);
        piece.style.setProperty("--puzzle-x", horizontal.toFixed(2) + "vw");
        piece.style.setProperty("--puzzle-y", vertical.toFixed(2) + "vh");
        piece.style.setProperty("--puzzle-rotate", "0deg");
        piece.style.setProperty("--puzzle-delay", Math.min(index * 34, 430) + "ms");
        piece.classList.remove("is-cover-puzzle-piece");
      });
      void pieces[0].offsetWidth;
      pieces.forEach(function (piece) { piece.classList.add("is-cover-puzzle-piece"); });
      global.clearTimeout(coverPuzzleTimer);
      coverPuzzleTimer = global.setTimeout(function () {
        pieces.forEach(function (piece) {
          piece.classList.remove("is-cover-puzzle-piece");
          piece.style.removeProperty("--puzzle-x");
          piece.style.removeProperty("--puzzle-y");
          piece.style.removeProperty("--puzzle-rotate");
          piece.style.removeProperty("--puzzle-delay");
        });
        coverPuzzleRunning = false;
        document.documentElement.classList.remove("cover-puzzle-lock");
        if (onComplete) onComplete();
      }, 1660);
      return true;
    }

    function isGuidelineVisible() {
      return gate && !gate.hidden
        && !gate.classList.contains("is-leaving")
        && !document.body.classList.contains("presentation-ui-hidden");
    }

    function refreshLoopBoundary() {
      loopBoundaryY = loopCoverSection.offsetTop;
    }

    function wrapForwardLoop(scrollY) {
      if (loopRepositioning) return true;
      if (!isFinite(loopBoundaryY) || scrollY < loopBoundaryY) return false;
      controlledScrollTarget = loopBoundaryY;
      furthestScrollY = loopBoundaryY;
      lastScrollY = loopBoundaryY;
      global.scrollTo(0, loopBoundaryY);
      refreshLoopBoundary();
      loopRepositioning = true;
      // Re-arm the cloned cover on every cycle so it always performs the same
      // assembly used by the opening cover, even after many loop passes.
      document.documentElement.classList.remove("cover-intro-complete");
      loopCoverSlide.mount();
      loopCoverSlide.reset();
      loopCoverSlide.updateScrollMotion();
      playCoverPuzzle(loopCoverSlide, function () {
        document.documentElement.classList.remove("cover-intro-complete");
        primaryMountedSlides.forEach(function (slide) { slide.reset(); });
        global.WordSlide.voiceReadyAt = 0;
        global.WordSlide.lastScrollY = 0;
        global.WordSlide.scrollDirection = 1;
        global.WordSlide.omissionScrollInput = 0;
        history.length = 0;
        controlledScrollTarget = 0;
        furthestScrollY = 0;
        lastScrollY = 0;
        global.scrollTo(0, 0);
        loopCoverSlide.reset();
        loopCoverSection.classList.add("is-loop-cover-pending");
        loopRepositioning = false;
        updateVirtualSlideWindow(true);
        primaryMountedSlides.forEach(function (slide) { slide.updateScrollMotion(); });
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
      if (isGuidelineVisible() || coverPuzzleRunning) return;
      var current = global.scrollY || 0;
      if (wrapForwardLoop(current)) {
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
      if (isGuidelineVisible() || coverPuzzleRunning) return;
      if (delta <= 0) return;
      var current = global.scrollY || 0;
      var maximumBacklog = Math.min(210, Math.max(120, global.innerHeight * 0.22));
      var softenedDelta = Math.tanh(delta / 100) * 40;
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

    function isVisibleIdleMotionTarget(target, includeTransparent) {
      if (!target || !global.Element || !(target instanceof global.Element)) return true;
      if ((blinkFlash && blinkFlash.contains(target))
          || (idleOmissionPrompt && idleOmissionPrompt.contains(target))) return false;
      if (!target.isConnected || target.closest("[hidden]")) return false;
      var style = global.getComputedStyle(target);
      if (style.display === "none" || style.visibility === "hidden"
          || (!includeTransparent && Number(style.opacity) === 0)) return false;
      var rect = target.getBoundingClientRect();
      var viewportWidth = global.innerWidth || document.documentElement.clientWidth;
      var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
      return rect.bottom > 0 && rect.top < viewportHeight
        && rect.right > 0 && rect.left < viewportWidth;
    }

    function hasActiveIdleBlockingMotion() {
      if (coverPuzzleRunning || controlledScrollFrame || loopRepositioning) return true;
      if (global.WordSlide.omissionPile.some(function (state) {
        return state.clone && state.clone.isConnected && (!state.settled || state.dismissing);
      })) return true;
      if (global.WordSlide.instances.some(function (slide) {
        return Boolean(slide.scrollFrame);
      })) return true;
      if (!document.getAnimations) return false;
      return document.getAnimations().some(function (animation) {
        if (animation.playState !== "running" && animation.playState !== "pending") return false;
        var target = animation.effect && animation.effect.target;
        return isVisibleIdleMotionTarget(target);
      });
    }

    function handleIdleBlockingMotionStart(event) {
      if (!isVisibleIdleMotionTarget(event.target, true)) return;
      noteIdleOmissionActivity();
    }

    function canMonitorIdleOmission() {
      return presentationUiDismissed
        && !isGuidelineVisible()
        && document.visibilityState !== "hidden";
    }

    function scheduleIdleOmissionPrompt() {
      global.clearTimeout(idleOmissionPromptTimer);
      idleOmissionPromptTimer = 0;
      if (!canMonitorIdleOmission()) {
        idleOmissionQuietStartedAt = 0;
        hideIdleOmissionPrompt();
        return;
      }
      var now = global.performance.now();
      if (hasActiveIdleBlockingMotion()) {
        idleOmissionQuietStartedAt = 0;
        idleOmissionPromptTimer = global.setTimeout(
          scheduleIdleOmissionPrompt,
          idleOmissionCheckIntervalMs
        );
        return;
      }
      if (!idleOmissionQuietStartedAt) idleOmissionQuietStartedAt = now;
      var delay = config.interaction.idleOmissionPromptDelayMs;
      var quietFor = now - idleOmissionQuietStartedAt;
      if (quietFor >= delay) {
        idleOmissionPrompt.hidden = false;
        void idleOmissionPrompt.offsetWidth;
        idleOmissionPrompt.classList.add("is-visible");
        return;
      }
      idleOmissionPromptTimer = global.setTimeout(
        scheduleIdleOmissionPrompt,
        Math.min(idleOmissionCheckIntervalMs, delay - quietFor)
      );
    }

    function noteIdleOmissionActivity() {
      idleOmissionQuietStartedAt = 0;
      global.clearTimeout(idleOmissionPromptTimer);
      idleOmissionPromptTimer = 0;
      hideIdleOmissionPrompt();
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
      if (!visibleTargets.length) return;
      var activeSlide = visibleTargets[0].slide;
      var groupIndex = visibleTargets[0].groupIndex;
      var level = omissionLevelFor(openDurationMs || 0);
      var omission = activeSlide.omitAtGroup(
        groupIndex,
        level,
        config.blink.paragraphGroupCount,
        allowIncomplete
      );
      if (!omission) return;
      noteIdleOmissionActivity();
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
      updateVirtualSlideWindow();
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

    function dismissPresentationGuideline() {
      if (!cameraPermissionGranted || presentationUiDismissed) return false;
      presentationUiDismissed = true;
      controlledScrollTarget = 0;
      furthestScrollY = 0;
      lastScrollY = 0;
      global.scrollTo(0, 0);
      global.WordSlide.lastScrollY = 0;
      global.WordSlide.scrollDirection = 1;
      playCoverPuzzle(primaryMountedSlides[0], function () {
        document.documentElement.classList.add("cover-intro-complete");
      });
      document.body.classList.add("presentation-ui-hidden");
      noteIdleOmissionActivity(global.performance.now());
      return true;
    }

    if (mobileGuideDismiss) {
      mobileGuideDismiss.addEventListener("click", function (event) {
        event.preventDefault();
        dismissPresentationGuideline();
      });
    }

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
        dismissPresentationGuideline();
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
      if (!isTyping && coverPuzzleRunning) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp"
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
    }, { passive: true });
    global.addEventListener("touchmove", function (event) {
      if (isGuidelineVisible() || coverPuzzleRunning) event.preventDefault();
    }, { passive: false });
    global.addEventListener("touchmove", function () {
      lastScrollInputAt = global.performance.now();
      noteIdleOmissionActivity(lastScrollInputAt);
    }, { passive: true });
    global.addEventListener("scroll", handleScroll, { passive: true });
    global.addEventListener("resize", function () {
      refreshLoopBoundary();
      updateVirtualSlideWindow(true);
    }, { passive: true });
    global.addEventListener("load", function () {
      refreshLoopBoundary();
      updateVirtualSlideWindow(true);
    }, { once: true });
    document.addEventListener("animationstart", handleIdleBlockingMotionStart, true);
    document.addEventListener("transitionrun", handleIdleBlockingMotionStart, true);
    document.addEventListener("visibilitychange", noteIdleOmissionActivity, { passive: true });
    global.addEventListener("beforeunload", function () {
      if (detector) detector.stop();
      global.cancelAnimationFrame(eyeTimerFrame);
      global.cancelAnimationFrame(virtualSlideFrame);
      global.clearTimeout(idleOmissionPromptTimer);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startApp, { once: true });
  } else {
    startApp();
  }
}(window));
