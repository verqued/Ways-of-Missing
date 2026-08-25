(function (global) {
  "use strict";

  function WordSlide(section, data) {
    this.section = section;
    this.data = data;
    this.groups = [];
    this.cursor = 0;
    this.scrollFrame = 0;
    this.legacySlide1InteractionsEnabled = data.id === "1"
      && Boolean(global.APP_CONFIG.interaction.legacySlide1InteractionsEnabled);
    this.prefersReducedMotion = global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  WordSlide.instances = [];
  WordSlide.voiceReadyAt = 0;
  WordSlide.lastScrollY = global.scrollY || 0;
  WordSlide.scrollDirection = 1;
  WordSlide.omissionPile = [];
  WordSlide.omissionScrollInput = 0;
  WordSlide.omissionClearThreshold = 2600;
  WordSlide.omissionMinimumDwellMs = 1600;
  WordSlide.getExclusiveFocus = function () {
    var currentScrollY = global.scrollY || 0;
    if (currentScrollY > WordSlide.lastScrollY) WordSlide.scrollDirection = 1;
    if (currentScrollY < WordSlide.lastScrollY) WordSlide.scrollDirection = -1;
    WordSlide.lastScrollY = currentScrollY;
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
    var focusTop = viewportHeight * 0.45;
    var focusBottom = viewportHeight * 0.65;
    var candidates = [];
    WordSlide.instances.forEach(function (slide, slideOrder) {
      var rect = slide.artboard.getBoundingClientRect();
      var seenAnchors = {};
      slide.data.markerRegions.forEach(function (region, regionIndex) {
        if (region.interactionType === "none") return;
        if (!slide.groups[regionIndex] || !slide.groups[regionIndex].length) return;
        var anchorIndex = typeof region.timingRegionIndex === "number" ? region.timingRegionIndex : regionIndex;
        if (seenAnchors[anchorIndex]) return;
        seenAnchors[anchorIndex] = true;
        var anchor = slide.data.markerRegions[anchorIndex];
        var position = rect.top + anchor.bounds.y / 1080 * rect.height;
        if (position >= focusTop && position <= focusBottom) {
          candidates.push({
            slide: slide,
            slideOrder: slideOrder,
            regionIndex: regionIndex,
            anchorIndex: anchorIndex,
            anchorOrder: slide.anchorOrderByIndex[anchorIndex],
            position: position,
            progress: Math.max(0, Math.min(1, (focusBottom - position) / (focusBottom - focusTop)))
          });
        }
      });
    });
    candidates.sort(function (a, b) {
      if (a.slideOrder !== b.slideOrder) return a.slideOrder - b.slideOrder;
      return WordSlide.scrollDirection > 0
        ? a.anchorOrder - b.anchorOrder
        : b.anchorOrder - a.anchorOrder;
    });
    return candidates.length ? candidates[0] : null;
  };

  WordSlide.prototype.slide1SequenceDuration = function (interactionType, regionIndex) {
    if (regionIndex === 3) return 760;
    var durations = {
      "voice-shake": 460, "voice-grow": 460, "voice-staccato": 540,
      "voice-swing": 620, "voice-bounce": 760, "voice-shrink": 520,
      "fast-sequence": 150, "demo-scale": 720, "caption-block": 360
    };
    return durations[interactionType] || 380;
  };

  WordSlide.prototype.prepareSlide1Sequence = function (exclusiveFocus) {
    if (!this.legacySlide1InteractionsEnabled) return;
    if (!this.slide1Sequence) {
      this.slide1Sequence = { nextIndex: 0, activeIndex: null, startedAt: 0, readyAt: 0, focusIndex: 0 };
    }
    if (!exclusiveFocus || exclusiveFocus.slide !== this) return;
    var sequence = this.slide1Sequence;
    var focusIndex = exclusiveFocus.regionIndex;
    sequence.focusIndex = Math.max(sequence.focusIndex || 0, focusIndex);
    // A fast wheel gesture can move the viewport beyond several markers. Do not
    // keep playing an invisible backlog: finish off-screen groups and animate the
    // group that is actually in the reading band.
    if (focusIndex >= sequence.nextIndex + 2) {
      sequence.nextIndex = focusIndex;
      sequence.activeIndex = null;
      sequence.startedAt = 0;
      sequence.readyAt = 0;
      for (var skipped = 0; skipped < focusIndex; skipped += 1) {
        this.data.markerRegions[skipped].maxForwardProgress = 1;
      }
    }
  };

  WordSlide.prototype.applySlide1Sequence = function (regionIndex, rawProgress, interactionType) {
    if (!this.legacySlide1InteractionsEnabled) return rawProgress;
    if (!this.slide1Sequence) {
      this.slide1Sequence = { nextIndex: 0, activeIndex: null, startedAt: 0, readyAt: 0, focusIndex: 0 };
    }
    var sequence = this.slide1Sequence;
    var now = global.performance.now();
    if (regionIndex < sequence.nextIndex) return 1;
    if (regionIndex > sequence.nextIndex) return 0;
    if (sequence.activeIndex === null) {
      if (rawProgress <= 0.001 || now < sequence.readyAt) return 0;
      sequence.activeIndex = regionIndex;
      sequence.startedAt = now;
    }
    if (sequence.activeIndex !== regionIndex) return 0;
    var duration = this.slide1SequenceDuration(interactionType, regionIndex);
    var backlog = Math.max(0, (sequence.focusIndex || regionIndex) - regionIndex);
    if (backlog === 1) duration *= 0.72;
    var progress = Math.max(0, Math.min(1, (now - sequence.startedAt) / duration));
    if (progress < 1) {
      this.requestScrollUpdate();
      return progress;
    }
    sequence.nextIndex = regionIndex + 1;
    sequence.activeIndex = null;
    var gap = regionIndex === 3 ? 90 : 45;
    sequence.readyAt = now + gap;
    global.setTimeout(function () { this.requestScrollUpdate(); }.bind(this), gap + 20);
    return 1;
  };

  WordSlide.prototype.mount = function () {
    var artboard = document.createElement("div");
    artboard.className = "slide__vector-artboard";
    var groups = this.data.markerRegions.map(function () { return []; });

    this.data.units.slice().sort(function (a, b) {
      if (a.sourceIndex !== b.sourceIndex) return b.sourceIndex - a.sourceIndex;
      return a.index - b.index;
    }).forEach(function (unit) {
      var image = document.createElement("img");
      image.className = "word-vector-unit word-vector-unit--" + unit.kind;
      var assetRevision = global.location.protocol === "file:"
        ? ""
        : "?v=" + encodeURIComponent(this.data.revision || "1");
      image.src = unit.asset + assetRevision;
      image.alt = "";
      image.draggable = false;
      image.decoding = "async";
      image.loading = "lazy";
      image.dataset.unitId = unit.id;
      image.dataset.groupIndex = String(unit.groupIndex);
      image.dataset.unitKind = unit.kind;
      image.dataset.sourceType = unit.sourceType || "Unknown";
      image.dataset.omissionStackable = unit.omissionStackable === false ? "false" : "true";
      image.dataset.omissionWhiteText = unit.omissionWhiteText ? "true" : "false";
      image.dataset.speakerLabel = unit.speakerLabel ? "true" : "false";
      image.dataset.motionX = String(unit.bounds.x);
      image.dataset.motionY = String(unit.bounds.y);
      image.dataset.motionWidth = String(unit.bounds.width);
      image.style.left = unit.bounds.x / 1920 * 100 + "%";
      image.style.top = unit.bounds.y / 1080 * 100 + "%";
      image.style.width = unit.bounds.width / 1920 * 100 + "%";
      image.style.aspectRatio = unit.bounds.width + " / " + unit.bounds.height;
      artboard.appendChild(image);
      groups[unit.groupIndex].push(image);
    });

    this.section.appendChild(artboard);
    this.artboard = artboard;
    this.groups = groups;
    this.darkRevealPanels = {};
    this.data.markerRegions.forEach(function (region, regionIndex) {
      if (region.interactionType !== "dark-reveal") return;
      var panel = document.createElement("div");
      panel.className = "word-dark-reveal-panel";
      panel.style.left = region.bounds.x / 1920 * 100 + "%";
      panel.style.top = region.bounds.y / 1080 * 100 + "%";
      panel.style.width = region.bounds.width / 1920 * 100 + "%";
      panel.style.height = region.bounds.height / 1080 * 100 + "%";
      artboard.insertBefore(panel, artboard.firstChild);
      this.darkRevealPanels[regionIndex] = panel;
    }, this);
    var uniqueAnchors = {};
    this.data.markerRegions.forEach(function (region, regionIndex) {
      var anchorIndex = typeof region.timingRegionIndex === "number" ? region.timingRegionIndex : regionIndex;
      uniqueAnchors[anchorIndex] = true;
    });
    this.anchorOrderByIndex = {};
    Object.keys(uniqueAnchors).map(Number).sort(function (a, b) {
      return a - b;
    }).forEach(function (anchorIndex, order) {
      this.anchorOrderByIndex[anchorIndex] = order;
    }, this);
    WordSlide.instances.push(this);
    this.groups.forEach(function (group, groupIndex) {
      var groupUsesTypeRight = this.data.markerRegions[groupIndex]
        && this.data.markerRegions[groupIndex].interactionType === "type-right";
      var typingWords = group.filter(function (unit) {
        return unit.dataset.unitKind === "word"
          && (groupUsesTypeRight || unit.dataset.speakerLabel !== "true");
      }).sort(function (a, b) {
        var yDifference = Number(a.dataset.motionY) - Number(b.dataset.motionY);
        return Math.abs(yDifference) > 3 ? yDifference : Number(a.dataset.motionX) - Number(b.dataset.motionX);
      });
      typingWords.forEach(function (unit, order) {
        unit.dataset.typingOrder = String(order);
        unit.dataset.typingCount = String(typingWords.length);
        unit.style.setProperty("--voice-delay", String(order * 75) + "ms");
      });
    }, this);
    this.initScrollMotion();
    return this;
  };

  WordSlide.prototype.updateScrollMotion = function () {
    var rect = this.artboard.getBoundingClientRect();
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
    var exclusiveFocus = WordSlide.getExclusiveFocus();
    this.prepareSlide1Sequence(exclusiveFocus);
    var motions = [
      { x:-105, y:8, scale:1, rotate:-0.6, blur:2, clip:[0,72,0,0], power:3 },
      { x:110, y:0, scale:1, rotate:0.5, blur:1.5, clip:[0,0,0,76], power:3 },
      { x:0, y:82, scale:0.96, rotate:0, blur:2, clip:[68,0,0,0], power:3 },
      { x:-76, y:28, scale:0.94, rotate:-1.2, blur:1.2, clip:[0,55,0,0], power:4 },
      { x:88, y:18, scale:1.04, rotate:1.1, blur:1.4, clip:[0,0,0,58], power:3 },
      { x:0, y:-58, scale:0.9, rotate:0, blur:2.4, clip:[0,0,62,0], power:3 },
      { x:-125, y:0, scale:1, rotate:0, blur:1.5, clip:[0,80,0,0], power:4 },
      { x:120, y:34, scale:0.97, rotate:0.8, blur:1, clip:[0,0,0,78], power:4 },
      { x:-66, y:50, scale:1.08, rotate:-1.4, blur:2, clip:[35,45,0,0], power:3 },
      { x:0, y:64, scale:0.82, rotate:0, blur:3, clip:[18,18,18,18], power:4 },
      { x:92, y:-22, scale:1, rotate:1.3, blur:1.3, clip:[0,0,0,64], power:3 },
      { x:-96, y:-18, scale:1, rotate:-1, blur:1.3, clip:[0,64,0,0], power:3 },
      { x:0, y:96, scale:0.95, rotate:0, blur:2.2, clip:[72,0,0,0], power:4 },
      { x:132, y:0, scale:1.03, rotate:0, blur:1.1, clip:[0,0,0,82], power:4 },
      { x:-118, y:20, scale:0.92, rotate:-0.8, blur:1.8, clip:[0,76,0,0], power:3 },
      { x:70, y:58, scale:1.1, rotate:1.5, blur:2.5, clip:[32,0,20,44], power:4 },
      { x:0, y:118, scale:0.88, rotate:0, blur:3, clip:[76,0,0,0], power:4 }
    ];
    var textModes = [
      "group-left", "caption-block", "group-left", "type-right", "group-left",
      "type-right", "group-left", "type-right", "group-left", "type-right",
      "group-left", "type-right", "group-left", "type-right", "group-left",
      "type-right", "group-left"
    ];

    var regionProgress = [];
    this.data.markerRegions.forEach(function (region, index) {
      var timingRegion = typeof region.timingRegionIndex === "number"
        ? this.data.markerRegions[region.timingRegionIndex]
        : region;
      var markerPosition = rect.top + timingRegion.bounds.y / 1080 * rect.height;
      var anchorIndex = typeof region.timingRegionIndex === "number" ? region.timingRegionIndex : index;
      var anchorOrder = this.anchorOrderByIndex[anchorIndex];
      var progress;
      if (region.interactionType === "none") {
        progress = 1;
      } else if (exclusiveFocus) {
        var currentSlideOrder = WordSlide.instances.indexOf(this);
        var isSameSlide = exclusiveFocus.slide === this;
        var completedSlide = WordSlide.scrollDirection > 0
          ? currentSlideOrder < exclusiveFocus.slideOrder
          : currentSlideOrder > exclusiveFocus.slideOrder;
        var completedAnchor = WordSlide.scrollDirection > 0
          ? anchorOrder < exclusiveFocus.anchorOrder
          : anchorOrder > exclusiveFocus.anchorOrder;
        progress = completedSlide || (isSameSlide && completedAnchor)
          ? 1
          : (isSameSlide && anchorOrder === exclusiveFocus.anchorOrder
            ? exclusiveFocus.progress
            : 0);
      } else {
        progress = markerPosition < viewportHeight * 0.45 ? 1 : 0;
      }
      // Cover exception: the pink opening block is present immediately, but
      // its following block must wait until the cover has actually moved.
      // This prevents the initial scroll-motion pass from revealing it before
      // the visitor supplies even a small amount of scroll input.
      var isCoverFirstReveal = this.section.id === "slide-cover"
        && !document.documentElement.classList.contains("cover-intro-complete")
        && index === 1;
      var coverHasStartedScrolling = this.section.getBoundingClientRect().top < -1;
      if (isCoverFirstReveal && !coverHasStartedScrolling) progress = 0;
      if (!this.legacySlide1InteractionsEnabled && typeof region.afterGroupIndex === "number" && WordSlide.scrollDirection > 0) {
        var predecessorProgress = regionProgress[region.afterGroupIndex] || 0;
        var predecessorRegion = this.data.markerRegions[region.afterGroupIndex];
        var predecessorIsVoice = predecessorRegion.interactionType.indexOf("voice-") === 0;
        var predecessorIsFast = predecessorRegion.interactionType === "fast-sequence";
        var predecessorIsTypeRight = predecessorRegion.interactionType === "type-right";
        var predecessorNow = global.performance.now();
        var predecessorAnchorIndex = typeof predecessorRegion.timingRegionIndex === "number"
          ? predecessorRegion.timingRegionIndex
          : region.afterGroupIndex;
        var predecessorIsCurrentFocus = exclusiveFocus
          && exclusiveFocus.slide === this
          && this.anchorOrderByIndex[predecessorAnchorIndex] === exclusiveFocus.anchorOrder;
        var predecessorComplete = predecessorIsVoice
          ? (typeof predecessorRegion.voiceEndAt === "number"
            ? predecessorNow >= predecessorRegion.voiceEndAt
            : predecessorProgress >= 0.999 && !predecessorIsCurrentFocus)
          : (predecessorIsFast
            ? (typeof predecessorRegion.fastEndAt === "number"
              && predecessorNow >= predecessorRegion.fastEndAt)
            : (predecessorIsTypeRight
              ? (typeof predecessorRegion.typeRightEndAt === "number"
                && predecessorNow >= predecessorRegion.typeRightEndAt)
              : predecessorProgress >= 0.995));
        var dependencyDelay = Number(region.startDelayAfterDependencyMs || 0);
        if (predecessorComplete && dependencyDelay > 0) {
          var dependencyNow = global.performance.now();
          if (typeof region.dependencyReadyAt !== "number") {
            region.dependencyReadyAt = dependencyNow + dependencyDelay;
            global.setTimeout(function () {
              WordSlide.instances.forEach(function (slide) { slide.requestScrollUpdate(); });
            }, dependencyDelay + 20);
          }
          predecessorComplete = dependencyNow >= region.dependencyReadyAt;
        }
        progress = predecessorComplete ? progress : 0;
        if (predecessorComplete && predecessorIsTypeRight) {
          if (typeof region.dependencyRevealStartAt !== "number") {
            region.dependencyRevealStartAt = predecessorNow;
          }
          var dependencyRevealProgress = Math.max(0, Math.min(1,
            (predecessorNow - region.dependencyRevealStartAt) / 480));
          progress = Math.min(progress, dependencyRevealProgress);
          if (dependencyRevealProgress < 1) this.requestScrollUpdate();
        }
      }
      if (!this.legacySlide1InteractionsEnabled && region.interactionType === "fast-sequence" && progress > 0.001
          && WordSlide.scrollDirection > 0) {
        var fastNow = global.performance.now();
        if (typeof region.fastStartAt !== "number") {
          region.fastStartAt = fastNow;
          region.fastEndAt = fastNow + 180;
          global.setTimeout(function () {
            WordSlide.instances.forEach(function (slide) { slide.requestScrollUpdate(); });
          }, 190);
        }
        progress = Math.max(0, Math.min(1, (fastNow - region.fastStartAt) / 180));
        if (progress < 1) this.requestScrollUpdate();
      }
      progress = this.applySlide1Sequence(index, progress, region.interactionType);
      // Forward scrolling is intentionally one-way. Once a region has begun
      // revealing, never let a transient focus handoff lower its progress; that
      // caused content to appear, disappear, and then appear again.
      if (WordSlide.scrollDirection > 0) {
        region.maxForwardProgress = Math.max(region.maxForwardProgress || 0, progress);
        progress = region.maxForwardProgress;
      }
      regionProgress[index] = progress;
      var isVoiceRegion = region.interactionType.indexOf("voice-") === 0;
      var isReverseScroll = WordSlide.scrollDirection < 0;
      var voiceNow = global.performance.now();
      var voiceDurations = {
        "voice-shake": 620,
          "voice-grow": 620,
        "voice-staccato": 760,
        "voice-swing": 920,
        "voice-bounce": 1220,
        "voice-shrink": 720
      };
      var isSlide1SequenceVoice = this.legacySlide1InteractionsEnabled && this.slide1Sequence
        && this.slide1Sequence.activeIndex === index;
      var isExclusiveVoiceFocus = isSlide1SequenceVoice || (exclusiveFocus
        && exclusiveFocus.slide === this
        && anchorOrder === exclusiveFocus.anchorOrder);
      if (isVoiceRegion && WordSlide.scrollDirection < 0 && markerPosition > viewportHeight * 0.65) {
        delete region.voiceQueued;
        delete region.voiceStartDelay;
        delete region.voiceStartAt;
        delete region.voiceEndAt;
      }
      if (isVoiceRegion && !isReverseScroll && isExclusiveVoiceFocus && !region.voiceQueued) {
        region.voiceQueued = true;
        global.setTimeout(function () {
          WordSlide.instances.forEach(function (slide) { slide.requestScrollUpdate(); });
        }, Math.max(0, WordSlide.voiceReadyAt - voiceNow) + 20);
      }
      var voiceGateReady = isSlide1SequenceVoice || voiceNow >= WordSlide.voiceReadyAt;
      if (isVoiceRegion && !isReverseScroll && region.voiceQueued && isExclusiveVoiceFocus
          && progress > 0.001 && voiceGateReady
          && typeof region.voiceStartAt !== "number") {
        var voiceStartAt = voiceNow;
        region.voiceStartDelay = 0;
        region.voiceStartAt = voiceStartAt;
        region.voiceEndAt = voiceStartAt + voiceDurations[region.interactionType];
        var voiceGap = 0;
        if (!isSlide1SequenceVoice) WordSlide.voiceReadyAt = region.voiceEndAt + voiceGap;
        global.setTimeout(function () {
          WordSlide.instances.forEach(function (slide) { slide.requestScrollUpdate(); });
        }, Math.max(0, region.voiceEndAt - voiceNow) + 20);
        global.setTimeout(function () {
          WordSlide.instances.forEach(function (slide) { slide.requestScrollUpdate(); });
        }, Math.max(0, WordSlide.voiceReadyAt - voiceNow) + 20);
      }
      var motion = motions[index % motions.length];
      var typeRightNow = global.performance.now();
      var isTypeRightRegion = region.interactionType === "type-right";
      var isExclusiveTypeRightFocus = exclusiveFocus
        && exclusiveFocus.slide === this
        && anchorOrder === exclusiveFocus.anchorOrder;
      if (isTypeRightRegion && progress > 0.001
          && (isExclusiveTypeRightFocus || progress >= 0.999)
          && typeof region.typeRightStartAt !== "number") {
        var typeRightWordCount = this.groups[index].filter(function (unit) {
          return unit.dataset.unitKind === "word";
        }).length;
        region.typeRightStartAt = typeRightNow + 60;
        region.typeRightDuration = Math.min(2900, Math.max(420, typeRightWordCount * 44 + 175));
        region.typeRightEndAt = region.typeRightStartAt + region.typeRightDuration;
        global.setTimeout(function () {
          WordSlide.instances.forEach(function (slide) { slide.requestScrollUpdate(); });
        }, region.typeRightDuration + 130);
      }
      var typeRightTimelineProgress = 0;
      if (isTypeRightRegion && typeof region.typeRightStartAt === "number") {
        typeRightTimelineProgress = Math.max(0, Math.min(1,
          (typeRightNow - region.typeRightStartAt) / region.typeRightDuration));
        if (typeRightTimelineProgress < 1) this.requestScrollUpdate();
      }
      var explicitTextModes = [
        "group-left", "group-right", "caption-block", "demo-scale", "dialogue-beat", "dialogue-from-left",
        "dialogue-from-right", "fast-sequence", "type-right", "dark-reveal", "tremble-in", "impact-type",
        "pink-angry-type", "pink-angry-followup", "pink-top-impact", "pink-top-impact-followup",
        "pink-impact-block", "pink-left-barrage", "underline-left-to-right", "none"
      ];
      var textMode = explicitTextModes.indexOf(region.interactionType) >= 0
        || region.interactionType.indexOf("voice-") === 0
        ? region.interactionType
        : textModes[index % textModes.length];
      if (this.legacySlide1InteractionsEnabled && index === 3) textMode = "group-left";
      var pinkAngryTimelineProgress = progress;
      if (((this.data.id === "5" && textMode === "pink-angry-type")
          || (this.data.id === "8" && textMode === "pink-top-impact")) && progress > 0.001) {
        if (typeof region.pinkAngryStartAt !== "number") region.pinkAngryStartAt = global.performance.now();
        pinkAngryTimelineProgress = Math.max(0, Math.min(1,
          (global.performance.now() - region.pinkAngryStartAt) / 850));
        if (pinkAngryTimelineProgress < 1) this.requestScrollUpdate();
      }
      if (textMode === "pink-angry-followup" || textMode === "pink-top-impact-followup") {
        pinkAngryTimelineProgress = 0;
        if (this._pinkAngryInteractionComplete) {
          if (typeof region.pinkAngryFollowupStartAt !== "number") {
            region.pinkAngryFollowupStartAt = global.performance.now();
          }
          pinkAngryTimelineProgress = Math.max(0, Math.min(1,
            (global.performance.now() - region.pinkAngryFollowupStartAt) / 850));
          if (pinkAngryTimelineProgress < 1) this.requestScrollUpdate();
        }
      }
      var pinkBarrageTimelineProgress = progress;
      if (this.data.id === "5" && textMode === "pink-left-barrage" && progress > 0.001) {
        if (typeof region.pinkBarrageStartAt !== "number") region.pinkBarrageStartAt = global.performance.now();
        pinkBarrageTimelineProgress = Math.max(0, Math.min(1,
          (global.performance.now() - region.pinkBarrageStartAt) / 1050));
        if (pinkBarrageTimelineProgress < 1) this.requestScrollUpdate();
      }
      var pinkImpactTimelineProgress = 0;
      var pinkImpactDelayReady = typeof this._pinkAngryInteractionStartedAt === "number"
        && global.performance.now() >= this._pinkAngryInteractionStartedAt + 800;
      if (textMode === "pink-impact-block" && pinkImpactDelayReady) {
        if (typeof region.pinkImpactStartAt !== "number") {
          region.pinkImpactStartAt = global.performance.now();
        }
        pinkImpactTimelineProgress = Math.max(0, Math.min(1,
          (global.performance.now() - region.pinkImpactStartAt) / 900));
        if (pinkImpactTimelineProgress < 1) this.requestScrollUpdate();
      }
      var eased = 1 - Math.pow(1 - progress, motion.power);
      var darkRevealPanel = this.darkRevealPanels[index];
      if (darkRevealPanel) {
        var surroundingProgress = index > 0 ? (regionProgress[index - 1] || 0) : progress;
        var panelProgress = Math.max(0, Math.min(1, surroundingProgress / 0.18));
        darkRevealPanel.style.setProperty("--dark-reveal-panel-opacity", panelProgress.toFixed(3));
      }
      this.groups[index].forEach(function (unit) {
        var unitEased = textMode === "none" ? 1 : eased;
        var darkTextProgress = 0;
        if (textMode === "dark-reveal") {
          darkTextProgress = Math.max(0, Math.min(1, (progress - 0.18) / 0.82));
          unitEased = Math.max(0, Math.min(1, darkTextProgress / 0.08));
        }
        var trembleY = 0;
        var impactY = 0;
        var impactScale = 1;
        if (textMode === "tremble-in" && !this.prefersReducedMotion) {
          var trembleProgress = Math.max(0, Math.min(1, (progress - 0.24) / 0.76));
          var trembleVisibility = Math.max(0, Math.min(1, trembleProgress / 0.3));
          unitEased = trembleVisibility * trembleVisibility * (3 - 2 * trembleVisibility);
          trembleY = Math.sin(trembleProgress * Math.PI * 4) * (1 - trembleProgress) * 8;
        }
        if (textMode === "impact-type" && !this.prefersReducedMotion) {
          var impactOrder = Number(unit.dataset.typingOrder || 0);
          var impactProgress = Math.max(0, Math.min(1, (progress - 0.2 - impactOrder * 0.2) / 0.6));
          unitEased = Math.max(0, Math.min(1, impactProgress / 0.12));
          if (impactProgress < 0.72) {
            var impactDrop = impactProgress / 0.72;
            impactScale = 3.2 + (0.92 - 3.2) * (1 - Math.pow(1 - impactDrop, 3));
            impactY = -18 * (1 - impactDrop);
          } else {
            var impactSettle = (impactProgress - 0.72) / 0.28;
            impactScale = 0.92 + 0.08 * impactSettle;
            impactY = Math.sin(impactSettle * Math.PI * 2) * (1 - impactSettle) * 3;
          }
        }
        if (this.legacySlide1InteractionsEnabled && index === 3 && !this.prefersReducedMotion) {
          var isSecondLeftParagraph = Number(unit.dataset.motionY) >= 450;
          var paragraphProgress = isSecondLeftParagraph
            ? Math.max(0, Math.min(1, (progress - 0.58) / 0.42))
            : Math.max(0, Math.min(1, progress / 0.42));
          unitEased = 1 - Math.pow(1 - paragraphProgress, motion.power);
        }
        var isWord = unit.dataset.unitKind === "word";
        var isSpeakerLabel = unit.dataset.speakerLabel === "true";
        var isTypeRight = textMode === "type-right";
        var isDarkReveal = textMode === "dark-reveal";
        var isTrembleIn = textMode === "tremble-in";
        var isImpactType = textMode === "impact-type";
        var isPinkTopImpactFollowup = textMode === "pink-top-impact-followup";
        var isPinkTopImpact = textMode === "pink-top-impact" || isPinkTopImpactFollowup;
        var isPinkAngryType = textMode === "pink-angry-type" || textMode === "pink-angry-followup" || isPinkTopImpact;
        var isPinkImpactBlock = textMode === "pink-impact-block";
        var isPinkLeftBarrage = textMode === "pink-left-barrage";
        var isUnderlineLeftToRight = textMode === "underline-left-to-right";
        var isPinkImpactReady = this.prefersReducedMotion || pinkImpactDelayReady;
        var isFastSequence = textMode === "fast-sequence";
        var isVoiceStaccato = textMode === "voice-staccato";
        var isTypingWord = isWord && (isTypeRight
          || (!isSpeakerLabel && !isReverseScroll && (isFastSequence || isVoiceStaccato)));
        var isGroupedLeft = textMode === "group-left";
        var isGroupedWord = isWord && isGroupedLeft;
        var isGroupedRight = textMode === "group-right";
        var isGroupedMotion = isGroupedLeft || isGroupedRight;
        var isCaptionBlock = textMode === "caption-block";
        var isDemoScale = isWord && textMode === "demo-scale";
        var isDialogueBeat = textMode === "dialogue-beat";
        var isDialogueFromLeft = textMode === "dialogue-from-left";
        var isDialogueFromRight = textMode === "dialogue-from-right";
        var isDirectionalDialogue = isDialogueFromLeft || isDialogueFromRight;
        var voiceModes = ["voice-shake", "voice-grow", "voice-staccato", "voice-swing", "voice-bounce", "voice-shrink"];
        var voiceScheduled = typeof region.voiceStartAt === "number";
        unit.style.setProperty("--voice-start-delay", "0ms");
        voiceModes.forEach(function (voiceMode) {
          unit.classList.toggle(
            "word-vector-unit--" + voiceMode,
            !isReverseScroll && textMode === voiceMode && voiceScheduled && progress > 0.001
          );
        });
        unit.classList.toggle("word-vector-unit--none", textMode === "none");
        unit.classList.toggle("word-vector-unit--dialogue", isDialogueBeat);
        unit.classList.toggle("word-vector-unit--dark-reveal", isDarkReveal);
        unit.classList.toggle("word-vector-unit--tremble-in", isTrembleIn);
        unit.classList.toggle("word-vector-unit--impact-type", isImpactType);
        unit.classList.toggle("word-vector-unit--pink-angry-type", false);
        unit.classList.toggle("word-vector-unit--pink-impact-block", isPinkImpactBlock && isPinkImpactReady);
        unit.classList.toggle("word-vector-unit--pink-left-barrage", isPinkLeftBarrage);
        unit.classList.toggle("word-vector-unit--demo-scale", isDemoScale);
        unit.classList.toggle("word-vector-unit--followup", typeof region.afterGroupIndex === "number");
        unit.classList.toggle("word-vector-unit--fast-sequence", isFastSequence);
        if (isTypingWord && !this.prefersReducedMotion) {
          var order = Number(unit.dataset.typingOrder);
          var count = Math.max(1, Number(unit.dataset.typingCount));
          var typingStart = order / count * (isFastSequence ? 0.38 : 0.82);
          var typingDuration = isFastSequence ? 0.055 : 0.09;
          var typingSourceProgress = isTypeRight ? typeRightTimelineProgress : progress;
          var typingProgress = Math.max(0, Math.min(1, (typingSourceProgress - typingStart) / typingDuration));
          unitEased = typingProgress < 0.5 ? 0 : 1;
        }
        var pinkAngryScale = 1;
        var pinkTopImpactY = 0;
        var pinkAngryProgress = 0;
        var pinkBarrageX = 0;
        var pinkBarrageScale = 1;
        var pinkBarrageRotate = 0;
        if (isPinkLeftBarrage && !this.prefersReducedMotion) {
          var pinkBarrageOrder = Number(unit.dataset.typingOrder || 0);
          var pinkBarrageCount = Math.max(1, Number(unit.dataset.typingCount || 1));
          var pinkBarrageStart = pinkBarrageOrder / pinkBarrageCount * 0.68;
          var pinkBarrageProgress = Math.max(0, Math.min(1, (pinkBarrageTimelineProgress - pinkBarrageStart) / 0.2));
          unitEased = pinkBarrageProgress > 0.001 ? 1 : 0;
          if (pinkBarrageProgress < 0.62) {
            var pinkBarrageStrike = pinkBarrageProgress / 0.62;
            var pinkBarrageEase = 1 - Math.pow(1 - pinkBarrageStrike, 4);
            pinkBarrageX = -900 * (1 - pinkBarrageEase);
            pinkBarrageScale = 5 + (0.58 - 5) * pinkBarrageEase;
            pinkBarrageRotate = (-16 + (pinkBarrageOrder % 3) * 8) * (1 - pinkBarrageEase);
          } else {
            var pinkBarrageSettle = (pinkBarrageProgress - 0.62) / 0.38;
            var pinkBarrageDamping = Math.exp(-4.8 * pinkBarrageSettle) * (1 - pinkBarrageSettle);
            pinkBarrageX = 34 * pinkBarrageDamping * Math.sin(pinkBarrageSettle * Math.PI * 2.35);
            pinkBarrageScale = 1 - 0.42 * Math.exp(-6.2 * pinkBarrageSettle)
              * Math.cos(pinkBarrageSettle * Math.PI * 2.2);
          }
        }
        if (isPinkAngryType && !this.prefersReducedMotion) {
          var pinkAngryOrder = Number(unit.dataset.typingOrder || 0);
          var pinkAngryCount = Math.max(1, Number(unit.dataset.typingCount || 1));
          var pinkAngryStart = pinkAngryOrder / pinkAngryCount * 0.72;
          pinkAngryProgress = Math.max(0, Math.min(1, (pinkAngryTimelineProgress - pinkAngryStart) / 0.18));
          unitEased = pinkAngryProgress;
          if (isPinkTopImpact && pinkAngryProgress < 0.7) {
            var topStrike = pinkAngryProgress / 0.7;
            var topStrikeEase = 1 - Math.pow(1 - topStrike, 4);
            pinkTopImpactY = -520 * (1 - topStrikeEase);
            pinkAngryScale = 2.15 + (0.84 - 2.15) * topStrikeEase;
          } else if (isPinkTopImpact) {
            var topSettle = (pinkAngryProgress - 0.7) / 0.3;
            var topDamping = Math.exp(-5.2 * topSettle) * (1 - topSettle);
            pinkTopImpactY = 24 * topDamping * Math.sin(topSettle * Math.PI * 2.15);
            pinkAngryScale = 1 - 0.22 * Math.exp(-6 * topSettle)
              * Math.cos(topSettle * Math.PI * 2.1);
          } else if (pinkAngryProgress < 0.72) {
            var angryStrike = pinkAngryProgress / 0.72;
            pinkAngryScale = 3.6 + (0.82 - 3.6) * (1 - Math.pow(1 - angryStrike, 3));
          } else {
            pinkAngryScale = 0.82 + 0.18 * ((pinkAngryProgress - 0.72) / 0.28);
          }
          if (pinkAngryProgress > 0.001 && !isPinkTopImpactFollowup
              && !unit._pinkTremblePlayed && unit.animate) {
            unit._pinkTremblePlayed = true;
            if (typeof this._pinkAngryInteractionStartedAt !== "number") {
              this._pinkAngryInteractionStartedAt = global.performance.now();
              global.setTimeout(function () {
                this.requestScrollUpdate();
              }.bind(this), 800);
              if (this.data.id === "5" && !this._pinkBarrageDirectScheduled) {
                this._pinkBarrageDirectScheduled = true;
                var pinkBarrageRegionIndex = this.data.markerRegions.findIndex(function (candidateRegion) {
                  return candidateRegion.interactionType === "pink-left-barrage";
                });
                var pinkBarrageRegion = this.data.markerRegions[pinkBarrageRegionIndex];
                if (pinkBarrageRegion) pinkBarrageRegion.pinkBarrageStartAt = global.performance.now();
                (this.groups[pinkBarrageRegionIndex] || []).slice().sort(function (leftUnit, rightUnit) {
                  return Number(leftUnit.dataset.motionX) - Number(rightUnit.dataset.motionX);
                }).forEach(function (barrageUnit, barrageOrder) {
                  if (!barrageUnit.animate) return;
                  barrageUnit._pinkBarrageAnimation = barrageUnit.animate([
                    { offset: 0, opacity: 0, transform: "translate3d(-900px,0,0) scale(5) rotate(-16deg)" },
                    { offset: 0.08, opacity: 1, transform: "translate3d(-900px,0,0) scale(5) rotate(-16deg)" },
                    { offset: 0.62, opacity: 1, transform: "translate3d(0,0,0) scale(0.58) rotate(0deg)" },
                    { offset: 0.76, opacity: 1, transform: "translate3d(34px,0,0) scale(1.08) rotate(0deg)" },
                    { offset: 0.89, opacity: 1, transform: "translate3d(-7px,0,0) scale(0.96) rotate(0deg)" },
                    { offset: 1, opacity: 1, transform: "translate3d(0,0,0) scale(1) rotate(0deg)" }
                  ], {
                    duration: 950,
                    delay: barrageOrder * 105,
                    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
                    fill: "both"
                  });
                  barrageUnit._pinkBarrageAnimation.onfinish = function () {
                    barrageUnit.style.setProperty("--scroll-x", "0px");
                    barrageUnit.style.setProperty("--scroll-scale-x", "1");
                    barrageUnit.style.setProperty("--scroll-scale-y", "1");
                    barrageUnit.style.setProperty("--scroll-rotate", "0deg");
                    barrageUnit.style.setProperty("--scroll-opacity", "1");
                    barrageUnit._pinkBarrageAnimation = null;
                  };
                });
              }
            }
            var pinkTrembleAmplitude = 1.9 + (pinkAngryOrder % 4) * 0.45;
            var pinkTrembleCycles = 11.5 + (pinkAngryOrder % 5) * 0.7;
            var pinkTremblePhase = (pinkAngryOrder % 6) * 0.14;
            var pinkTrembleFrames = [];
            for (var pinkFrameIndex = 0; pinkFrameIndex <= 80; pinkFrameIndex += 1) {
              var pinkFrameProgress = pinkFrameIndex / 80;
              var pinkFadeIn = Math.min(1, pinkFrameProgress / 0.08);
              var pinkFadeOut = pinkFrameProgress < 0.72
                ? 1
                : Math.pow(Math.max(0, (1 - pinkFrameProgress) / 0.28), 1.35);
              var pinkEnvelope = pinkFadeIn * pinkFadeOut;
              var pinkOffset = Math.sin(
                (pinkFrameProgress * pinkTrembleCycles + pinkTremblePhase) * Math.PI * 2
              ) * pinkTrembleAmplitude * pinkEnvelope;
              if (pinkFrameIndex === 0 || pinkFrameIndex === 80) pinkOffset = 0;
              pinkTrembleFrames.push({ offset: pinkFrameProgress, marginTop: pinkOffset.toFixed(2) + "px" });
            }
            var pinkTrembleDuration = (this.data.id === "1" || this.data.id === "13"
              || this.data.id === "16") ? 1300 : 2000;
            unit._pinkTrembleAnimation = unit.animate(pinkTrembleFrames, {
              duration: pinkTrembleDuration,
              easing: "linear",
              fill: "none"
            });
            unit._pinkTrembleAnimation.onfinish = function () {
              unit.style.marginTop = "0px";
              unit._pinkTrembleAnimation = null;
              var pinkAngryFinished = this.groups[index].every(function (candidate) {
                return candidate._pinkTremblePlayed && !candidate._pinkTrembleAnimation;
              });
              if (pinkAngryFinished) {
                this._pinkAngryInteractionComplete = true;
                this.requestScrollUpdate();
              }
            }.bind(this);
          }
          unit.classList.toggle("word-vector-unit--pink-angry-type", pinkAngryProgress > 0.001);
        }
        // Reduced motion removes interpolation, not the reveal condition. Future
        // slides must remain hidden until their marker reaches the focus band.
        var reducedProgress = progress > 0.001 ? 1 : 0;
        var remainder = this.prefersReducedMotion ? 1 - reducedProgress : 1 - unitEased;
        var opacity = this.prefersReducedMotion ? reducedProgress : unitEased;
        if (isDirectionalDialogue && !this.prefersReducedMotion) {
          var directionalProgress = Math.max(0, Math.min(1, (progress - 0.16) / 0.84));
          unitEased = 1 - Math.pow(1 - directionalProgress, motion.power);
          remainder = 1 - unitEased;
          opacity = unitEased;
        }
        var motionX = isDemoScale || isDarkReveal || isTrembleIn || isImpactType || isPinkAngryType || isPinkImpactBlock || isPinkLeftBarrage ? 0 : (isDirectionalDialogue
          ? (isDialogueFromLeft ? -132 : 132)
          : (isCaptionBlock ? 72 : (isGroupedRight ? 104 : (isTypeRight ? 76 : (isGroupedLeft ? -104 : motion.x)))));
        var motionY = isCaptionBlock || isGroupedMotion || isTypeRight || isDarkReveal || isTrembleIn || isImpactType || isPinkAngryType || isPinkImpactBlock || isPinkLeftBarrage ? 0 : (isWord ? (isTypingWord ? 4 : 0) : motion.y);
        var motionScale = isCaptionBlock || isGroupedMotion || isTypeRight || isDarkReveal || isTrembleIn || isImpactType || isPinkAngryType || isPinkImpactBlock || isPinkLeftBarrage || isDirectionalDialogue || isWord ? 1 : motion.scale;
        var motionRotate = isCaptionBlock || isGroupedMotion || isTypeRight || isDarkReveal || isTrembleIn || isImpactType || isDirectionalDialogue || isWord ? 0 : motion.rotate;
        var motionBlur = isGroupedMotion || isTypeRight || isDarkReveal || isTrembleIn || isImpactType ? 0 : (isCaptionBlock ? 1 : (isWord ? (isTypingWord ? 0.8 : 1.2) : motion.blur));
        var clip = isCaptionBlock || isGroupedMotion || isTypeRight || isDarkReveal || isTrembleIn || isImpactType || isDirectionalDialogue || isWord ? [0, 0, 0, 0] : motion.clip;
        unit.style.setProperty("--scroll-x", (motionX * remainder).toFixed(2) + "px");
        unit.style.setProperty("--scroll-y", (motionY * remainder).toFixed(2) + "px");
        unit.style.setProperty("--scroll-scale", (1 + (motionScale - 1) * remainder).toFixed(4));
        unit.style.setProperty("--scroll-rotate", (motionRotate * remainder).toFixed(3) + "deg");
        unit.style.setProperty("--scroll-blur", (motionBlur * remainder).toFixed(2) + "px");
        unit.style.setProperty("--clip-top", (clip[0] * remainder).toFixed(2) + "%");
        unit.style.setProperty("--clip-right", (clip[1] * remainder).toFixed(2) + "%");
        unit.style.setProperty("--clip-bottom", (clip[2] * remainder).toFixed(2) + "%");
        unit.style.setProperty("--clip-left", (clip[3] * remainder).toFixed(2) + "%");
        unit.style.setProperty("--scroll-opacity", opacity.toFixed(3));
        if (isDarkReveal) {
          unit.style.setProperty("--clip-right", ((1 - darkTextProgress) * 100).toFixed(2) + "%");
        }
        if (isTrembleIn && !this.prefersReducedMotion) {
          var trembleDelay = -(Math.round(Number(unit.dataset.motionX || 0)) % 280);
          unit.style.setProperty("--tremble-delay", trembleDelay + "ms");
          unit.style.setProperty("--scroll-y", trembleY.toFixed(2) + "px");
        }
        if (isImpactType && !this.prefersReducedMotion) {
          unit.style.setProperty("--scroll-y", impactY.toFixed(2) + "px");
          unit.style.setProperty("--scroll-scale-x", impactScale.toFixed(4));
          unit.style.setProperty("--scroll-scale-y", impactScale.toFixed(4));
        }
        if (isPinkAngryType && !this.prefersReducedMotion) {
          if (isPinkTopImpact) unit.style.setProperty("--scroll-y", pinkTopImpactY.toFixed(2) + "px");
          unit.style.setProperty("--scroll-scale-x", pinkAngryScale.toFixed(4));
          unit.style.setProperty("--scroll-scale-y", pinkAngryScale.toFixed(4));
        }
        if (isPinkLeftBarrage && !this.prefersReducedMotion) {
          unit.style.setProperty("--scroll-x", pinkBarrageX.toFixed(2) + "px");
          unit.style.setProperty("--scroll-scale-x", pinkBarrageScale.toFixed(4));
          unit.style.setProperty("--scroll-scale-y", pinkBarrageScale.toFixed(4));
          unit.style.setProperty("--scroll-rotate", pinkBarrageRotate.toFixed(3) + "deg");
        }
        if (isPinkImpactBlock && !this.prefersReducedMotion) {
          var blockProgress = this.prefersReducedMotion ? 1 : pinkImpactTimelineProgress;
          var blockX;
          var blockScale;
          if (blockProgress < 0.58) {
            var blockStrike = blockProgress / 0.58;
            var blockEase = 1 - Math.pow(1 - blockStrike, 4);
            blockX = 520 * (1 - blockEase);
            blockScale = 3 + (0.7 - 3) * blockEase;
          } else {
            var blockSettle = (blockProgress - 0.58) / 0.42;
            var blockDamping = Math.exp(-4.8 * blockSettle) * (1 - blockSettle);
            blockX = -24 * blockDamping * Math.sin(blockSettle * Math.PI * 2.35);
            blockScale = 1 - 0.3 * Math.exp(-6.2 * blockSettle)
              * Math.cos(blockSettle * Math.PI * 2.2);
          }
          unit.style.setProperty("--scroll-x", blockX.toFixed(2) + "px");
          unit.style.setProperty("--scroll-y", "0px");
          unit.style.setProperty("--scroll-scale-x", blockScale.toFixed(4));
          unit.style.setProperty("--scroll-scale-y", blockScale.toFixed(4));
          unit.style.setProperty("--scroll-opacity", (isPinkImpactReady && blockProgress > 0.001 ? 1 : 0).toFixed(3));
        }
        if (isUnderlineLeftToRight) {
          unit.style.setProperty("--scroll-x", "0px");
          unit.style.setProperty("--scroll-y", "0px");
          unit.style.setProperty("--scroll-opacity", progress > 0.001 ? "1" : "0");
          unit.style.setProperty("--clip-right", ((1 - unitEased) * 100).toFixed(2) + "%");
        }
        if (isDemoScale && !this.prefersReducedMotion) {
          var demoOrder = Number(unit.dataset.typingOrder);
          var demoCount = Math.max(1, Number(unit.dataset.typingCount));
          var focus = progress * (demoCount + 1) - 1;
          var distance = Math.abs(demoOrder - focus);
          var influence = Math.exp(-distance * distance * 3.2);
          var uniformScale = 1 + influence * 1.6;
          var demoWords = this.groups[index].filter(function (candidate) {
            return candidate.dataset.unitKind === "word";
          }).sort(function (a, b) {
            return Number(a.dataset.typingOrder) - Number(b.dataset.typingOrder);
          });
          var weightedWidth = 0;
          var weightTotal = 0;
          demoWords.forEach(function (candidate) {
            var candidateDistance = Number(candidate.dataset.typingOrder) - focus;
            var candidateWeight = Math.exp(-candidateDistance * candidateDistance * 3.2);
            weightedWidth += Number(candidate.dataset.motionWidth || 0) * candidateWeight;
            weightTotal += candidateWeight;
          });
          weightedWidth = weightTotal ? weightedWidth / weightTotal : 0;
          var focusClamped = Math.max(0, Math.min(demoCount - 1, focus));
          var nearestDistance = Math.abs(Math.round(focusClamped) - focus);
          var dominantInfluence = Math.exp(-nearestDistance * nearestDistance * 3.2);
          var pushDistance = Math.min(60, weightedWidth * 0.72 + 10) * dominantInfluence;
          var pushDirection = Math.max(-1, Math.min(1, (demoOrder - focus) * 1.5));
          unit.style.setProperty("--scroll-x", (pushDirection * pushDistance).toFixed(2) + "px");
          unit.style.setProperty("--scroll-scale-x", uniformScale.toFixed(4));
          unit.style.setProperty("--scroll-scale-y", uniformScale.toFixed(4));
          var demoVisibility = Math.max(0, Math.min(1, progress / 0.08));
          unit.style.setProperty("--scroll-opacity", demoVisibility.toFixed(3));
          unit.style.setProperty("--scroll-blur", "0px");
        } else if (isDialogueBeat && !this.prefersReducedMotion) {
          var dialogueVisible = progress >= 0.58;
          unit.style.setProperty("--scroll-x", "0px");
          unit.style.setProperty("--scroll-y", dialogueVisible ? "0px" : "14px");
          unit.style.setProperty("--scroll-scale", dialogueVisible ? "1" : "0.985");
          unit.style.setProperty("--scroll-opacity", dialogueVisible ? "1" : "0");
          unit.style.setProperty("--scroll-blur", dialogueVisible ? "0px" : "1.5px");
        } else if (textMode.indexOf("voice-") === 0 && voiceScheduled
            && !isReverseScroll && !isVoiceStaccato && !this.prefersReducedMotion) {
          var voiceVisibility = Math.max(0, Math.min(1, progress / 0.1));
          var voiceScale = 1;
          var voiceX = 0;
          var voiceY = 0;
          var voiceRotate = 0;
          if (textMode === "voice-shake") {
            voiceY = Math.sin(progress * Math.PI * 10) * (1 - progress) * 9;
          } else if (textMode === "voice-grow") {
            voiceScale = 1;
          } else if (textMode === "voice-swing") {
            voiceX = -72 * (1 - progress);
            voiceRotate = -3.2 * (1 - progress);
          } else if (textMode === "voice-shrink") {
            voiceScale = 1;
          }
          unit.style.setProperty("--scroll-x", voiceX.toFixed(2) + "px");
          unit.style.setProperty("--scroll-y", voiceY.toFixed(2) + "px");
          unit.style.setProperty("--scroll-scale", voiceScale.toFixed(4));
          unit.style.setProperty("--scroll-rotate", voiceRotate.toFixed(3) + "deg");
          unit.style.setProperty("--scroll-opacity", voiceVisibility.toFixed(3));
          unit.style.setProperty("--scroll-blur", "0px");
        } else if (textMode.indexOf("voice-") === 0 && !voiceScheduled
            && !isReverseScroll && !this.prefersReducedMotion) {
          var skippedVoice = !isExclusiveVoiceFocus && progress >= 0.999;
          unit.style.setProperty("--scroll-x", "0px");
          unit.style.setProperty("--scroll-y", "0px");
          unit.style.setProperty("--scroll-scale", "1");
          unit.style.setProperty("--scroll-rotate", "0deg");
          unit.style.setProperty("--scroll-opacity", skippedVoice ? "1" : "0");
          unit.style.setProperty("--scroll-blur", "0px");
        } else if (!isImpactType && !isPinkAngryType && !isPinkImpactBlock && !isPinkLeftBarrage) {
          unit.style.removeProperty("--scroll-scale-x");
          unit.style.removeProperty("--scroll-scale-y");
        }
      }, this);
    }, this);
  };

  WordSlide.prototype.requestScrollUpdate = function () {
    if (this.scrollFrame) return;
    this.scrollFrame = global.requestAnimationFrame(function () {
      this.scrollFrame = 0;
      this.updateScrollMotion();
    }.bind(this));
  };

  WordSlide.prototype.initScrollMotion = function () {
    this.updateScrollMotion();
    global.addEventListener("scroll", this.requestScrollUpdate.bind(this), { passive: true });
    global.addEventListener("resize", this.requestScrollUpdate.bind(this), { passive: true });
    global.addEventListener("load", this.requestScrollUpdate.bind(this), { once: true });
  };

  WordSlide.prototype.isActive = function () {
    var rect = this.section.getBoundingClientRect();
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
    var visible = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
    return visible / Math.min(viewportHeight, rect.height) >= 0.18;
  };

  WordSlide.prototype.isGroupFullyRevealed = function (groupIndex) {
    var region = this.data.markerRegions[groupIndex];
    var group = this.groups[groupIndex];
    if (!region || !group || !group.length || (region.maxForwardProgress || 0) < 0.999) return false;
    var now = global.performance.now();
    if (typeof region.dependencyReadyAt === "number" && now < region.dependencyReadyAt) return false;
    if (typeof region.fastEndAt === "number" && now < region.fastEndAt) return false;
    if (region.interactionType.indexOf("voice-") === 0
        && typeof region.voiceEndAt === "number" && now < region.voiceEndAt) return false;
    if (region.interactionType === "type-right"
        && (typeof region.typeRightEndAt !== "number" || now < region.typeRightEndAt)) return false;
    return group.every(function (unit) {
      return Number(unit.style.getPropertyValue("--scroll-opacity") || 0) >= 0.999;
    });
  };

  WordSlide.prototype.isUnitVisibleForOmission = function (unit, allowIncomplete) {
    if (!unit || unit.classList.contains("is-omitted") || unit.classList.contains("is-omitted-character")) return false;
    var minimumOpacity = allowIncomplete ? 0.01 : 0.999;
    if (Number(unit.style.getPropertyValue("--scroll-opacity") || 0) < minimumOpacity) return false;
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
    var viewportWidth = global.innerWidth || document.documentElement.clientWidth;
    var rect = unit.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < viewportHeight && rect.right > 0 && rect.left < viewportWidth;
  };

  WordSlide.prototype.hasVisibleOmittableContent = function (groupIndex, allowIncomplete) {
    return Boolean(this.groups[groupIndex] && this.groups[groupIndex].some(function (unit) {
      return this.isUnitVisibleForOmission(unit, allowIncomplete);
    }, this));
  };

  WordSlide.prototype.findCompletedGroupAtOrBefore = function (groupIndex) {
    for (var candidate = Math.min(groupIndex, this.groups.length - 1); candidate >= 0; candidate -= 1) {
      if (this.isGroupFullyRevealed(candidate) && this.hasVisibleOmittableContent(candidate)) return candidate;
    }
    return null;
  };


  WordSlide.prototype.findClosestVisibleCompletedGroup = function (allowIncomplete) {
    var viewportHeight = global.innerHeight || document.documentElement.clientHeight;
    var focusY = viewportHeight * 0.55;
    var candidates = [];
    this.groups.forEach(function (group, groupIndex) {
      if ((!allowIncomplete && !this.isGroupFullyRevealed(groupIndex))
          || !this.hasVisibleOmittableContent(groupIndex, allowIncomplete)) return;
      var visibleRects = group.filter(function (unit) {
        return this.isUnitVisibleForOmission(unit, allowIncomplete);
      }, this).map(function (unit) {
        return unit.getBoundingClientRect();
      }).filter(function (rect) {
        return rect.bottom > 0 && rect.top < viewportHeight;
      });
      if (!visibleRects.length) return;
      var top = Math.min.apply(null, visibleRects.map(function (rect) { return rect.top; }));
      var bottom = Math.max.apply(null, visibleRects.map(function (rect) { return rect.bottom; }));
      var center = (top + bottom) / 2;
      candidates.push({ groupIndex: groupIndex, distance: Math.abs(center - focusY), center: center });
    }, this);
    candidates.sort(function (first, second) {
      if (first.distance !== second.distance) return first.distance - second.distance;
      return second.center - first.center;
    });
    return candidates.length ? candidates[0] : null;
  };

  WordSlide.prototype.ensureOmissionLayer = function () {
    if (WordSlide.omissionLayer && WordSlide.omissionLayer.isConnected) return WordSlide.omissionLayer;
    var layer = document.createElement("div");
    layer.className = "omission-animation-layer";
    var floor = document.createElement("div");
    floor.className = "omission-floor";
    layer.appendChild(floor);
    document.body.appendChild(layer);
    WordSlide.omissionLayer = layer;
    WordSlide.omissionFloor = floor;
    return layer;
  };

  WordSlide.prototype.updateOmissionFloor = function () {
    this.ensureOmissionLayer();
    return (global.innerHeight || document.documentElement.clientHeight) - 3;
  };

  WordSlide.noteOmissionScroll = function (delta) {
    var liveWords = WordSlide.omissionPile.filter(function (state) {
      return state.stackable && !state.dismissing && state.clone && state.clone.isConnected;
    });
    if (!liveWords.length) {
      WordSlide.omissionScrollInput = 0;
      return;
    }
    WordSlide.omissionScrollInput += Math.abs(delta || 0);
    if (WordSlide.omissionScrollInput < WordSlide.omissionClearThreshold) return;
    // Never remove the floor from under a word that is still falling. The input
    // remains accumulated and the next wheel input retries after the pile rests.
    if (liveWords.some(function (state) { return !state.settled; })) return;
    var now = global.performance.now();
    if (liveWords.some(function (state) {
      return now - (state.settledAt || now) < WordSlide.omissionMinimumDwellMs;
    })) return;
    WordSlide.omissionScrollInput = 0;
    // Highest words leave first, so no visible word is left floating after its
    // supporting word has disappeared.
    liveWords.sort(function (first, second) { return first.y - second.y; });
    liveWords.forEach(function (state, index) {
      state.dismissing = true;
      global.setTimeout(function () {
        if (!state.clone || !state.clone.isConnected) return;
        state.clone.style.transition = "opacity 820ms ease, filter 820ms ease, transform 920ms cubic-bezier(.22,.61,.36,1)";
        state.clone.style.opacity = "0";
        state.clone.style.filter = "blur(1.2px)";
        state.clone.style.transform = state.lastTransform + " translateY(34px) rotate(" + state.clearTilt.toFixed(2) + "deg)";
        global.setTimeout(function () {
          if (state.clone && state.clone.parentNode) state.clone.parentNode.removeChild(state.clone);
          state.clone = null;
          WordSlide.omissionPile = WordSlide.omissionPile.filter(function (item) { return item !== state; });
        }, 980);
      }, Math.min(index * 48, 420));
    });
  };

  WordSlide.prototype.isBlueInteractionUnit = function (unit) {
    if (!unit) return false;
    if ((unit.dataset.unitId || "").indexOf("blue-group-") === 0) return true;
    var groupIndex = Number(unit.dataset.groupIndex);
    var region = this.data.markerRegions[groupIndex];
    var color = region && region.markerColor;
    return Boolean(color && color.type === "RGB" && color.r < 80 && color.g < 100 && color.b > 180);
  };

  WordSlide.prototype.blueInteractionUnits = function (groupIndex) {
    return (this.groups[groupIndex] || []).filter(function (unit) {
      return this.isBlueInteractionUnit(unit);
    }, this);
  };

  WordSlide.prototype.dropOmittedUnit = function (unit, omissionIndex) {
    if (!unit || unit._omissionDrop) return;
    var rect = unit.getBoundingClientRect();
    var clone = unit.cloneNode(true);
    clone.className = "word-fall-clone";
    clone.removeAttribute("data-unit-id");
    var startX = rect.left;
    var startY = rect.top;
    clone.style.left = startX + "px"; clone.style.top = startY + "px";
    clone.style.width = rect.width + "px"; clone.style.height = rect.height + "px";
    clone.style.aspectRatio = "auto"; clone.style.opacity = "1";
    clone.style.filter = unit.dataset.omissionWhiteText === "true"
      ? "drop-shadow(0 0 0.8px rgba(0,0,0,.52))" : "none";
    clone.style.clipPath = "none";
    clone.style.transform = "translate3d(0,0,0) rotate(0deg)";
    this.ensureOmissionLayer().appendChild(clone);
    unit.classList.add("is-omitted");
    var random = Math.random;
    var state = {clone:clone,frame:0,startAt:global.performance.now()+250+random()*90,lastAt:0,
      startX:startX,startY:startY,x:startX,y:startY,preferredX:startX,
      velocityX:(random()*2-1)*(18+random()*34),accelerationX:(random()*2-1)*(8+random()*18),velocityY:105+random()*50,
      gravity:920+random()*420,rotation:0,angularVelocity:(random()*2-1)*(7+random()*13),
      bounceCount:0,settled:false,dismissing:false,stackable:unit.dataset.unitKind === "word" && unit.dataset.omissionStackable !== "false",clearTilt:(random()*2-1)*4,lastTransform:"",
      width:rect.width,height:rect.height,targetX:startX,targetY:startY};
    state.preferredX = startX + state.velocityX * 0.72;
    if (state.stackable) {
      var viewportWidth = global.innerWidth || document.documentElement.clientWidth;
      var floorY = this.updateOmissionFloor() - rect.height;
      var minimumFallDistance = Math.max(72, rect.height * 2.5);
      if (floorY-startY < minimumFallDistance) state.stackable=false;
      var spread = Math.max(18, Math.min(58, rect.width * 0.72));
      var candidates = [state.preferredX, state.preferredX-spread, state.preferredX+spread,
        state.preferredX-spread*2, state.preferredX+spread*2];
      var reservedLanding = null;
      if (state.stackable) candidates.forEach(function (candidateX) {
        candidateX = Math.max(2, Math.min(viewportWidth-rect.width-2, candidateX));
        var candidateY = floorY;
        WordSlide.omissionPile.forEach(function (other) {
          if (!other.stackable || !other.clone || other.dismissing) return;
          var otherX = typeof other.targetX === "number" ? other.targetX : other.x;
          var otherY = typeof other.targetY === "number" ? other.targetY : other.y;
          var horizontalOverlap = candidateX < otherX + other.width - 3
            && candidateX + rect.width > otherX + 3;
          if (horizontalOverlap) candidateY = Math.min(candidateY, otherY - rect.height + 2);
        });
        candidateY = Math.max(startY, candidateY);
        if (!reservedLanding || candidateY > reservedLanding.y + 1
            || (Math.abs(candidateY-reservedLanding.y) <= 1
              && Math.abs(candidateX-state.preferredX) < Math.abs(reservedLanding.x-state.preferredX))) {
          reservedLanding = {x:candidateX,y:candidateY};
        }
      });
      if (state.stackable && reservedLanding) {
        state.targetX = reservedLanding.x;
        state.targetY = reservedLanding.y;
      }
    }
    unit._omissionDrop = state;
    WordSlide.omissionPile.push(state);
    function render() {
      state.lastTransform = "translate3d(" + (state.x-startX).toFixed(2) + "px,"
        + (state.y-startY).toFixed(2) + "px,0) rotate(" + state.rotation.toFixed(2) + "deg)";
      clone.style.transform = state.lastTransform;
    }
    function tick(now) {
      if (unit._omissionDrop !== state || state.settled || state.dismissing) return;
      if (now < state.startAt) { render(); state.frame=global.requestAnimationFrame(tick.bind(this)); return; }
      var dt=Math.min(0.034,Math.max(0.001,(now-(state.lastAt||now))/1000)); state.lastAt=now;
      state.velocityY+=state.gravity*dt;
      state.y+=state.velocityY*dt;
      var fallenDistance = state.y-state.startY;
      var directionalReady = fallenDistance > Math.max(18, rect.height);
      if (directionalReady) {
        var horizontalAcceleration = state.accelerationX;
        if (state.stackable) {
          var travel = Math.max(1, state.targetY-state.startY);
          var fallRatio = Math.max(0, Math.min(1, fallenDistance/travel));
          if (fallRatio > 0.52) {
            var steeringRatio = (fallRatio-0.52)/0.48;
            var spring = 5+steeringRatio*9;
            var damping = 2.4+steeringRatio*3.6;
            horizontalAcceleration = state.accelerationX*(1-steeringRatio)
              +(state.targetX-state.x)*spring-state.velocityX*damping;
          }
        }
        state.velocityX += horizontalAcceleration*dt;
        state.velocityX *= Math.pow(0.992,dt*60);
        state.x += state.velocityX*dt;
        var viewportWidth = global.innerWidth || document.documentElement.clientWidth;
        if (state.x < 2) { state.x=2; state.velocityX=Math.abs(state.velocityX)*0.34; }
        if (state.x+rect.width > viewportWidth-2) {
          state.x=viewportWidth-rect.width-2; state.velocityX=-Math.abs(state.velocityX)*0.34;
        }
        state.rotation += state.angularVelocity*dt;
        state.angularVelocity *= Math.pow(0.998,dt*60);
      }
      if (!state.stackable) {
        render();
        if (state.y > (global.innerHeight || document.documentElement.clientHeight) + rect.height) {
          state.settled=true;
          if (clone.parentNode) clone.parentNode.removeChild(clone);
          state.clone=null;
          WordSlide.omissionPile = WordSlide.omissionPile.filter(function (item) { return item !== state; });
          return;
        }
        state.frame=global.requestAnimationFrame(tick.bind(this));
        return;
      }
      if (state.y >= state.targetY) {
        state.y=state.targetY;
        if (state.bounceCount === 0 && state.velocityY > 260) {
          state.velocityY=-Math.min(155,Math.max(68,state.velocityY*0.17));
          state.velocityX*=0.38; state.angularVelocity*=0.46; state.bounceCount=1;
        } else {
          state.velocityY=0; state.velocityX=0; state.angularVelocity=0;
          state.targetX=state.x;
          state.settled=true; state.settledAt=now;
          state.rotation=Math.max(-6,Math.min(6,state.rotation));
          render();
          return;
        }
      }
      render();
      state.frame=global.requestAnimationFrame(tick.bind(this));
    }
    state.frame=global.requestAnimationFrame(tick.bind(this));
  };

  WordSlide.prototype.clearDroppedUnit = function (unit) {
    var state=unit&&unit._omissionDrop;
    if (state) {
      global.cancelAnimationFrame(state.frame);
      if (state.clone&&state.clone.parentNode) state.clone.parentNode.removeChild(state.clone);
      WordSlide.omissionPile = WordSlide.omissionPile.filter(function (item) { return item !== state; });
      delete unit._omissionDrop;
    }
    if (unit) {unit.classList.remove("is-omitted");unit.classList.remove("is-omitted-character");}
  };

  WordSlide.prototype.omitNextGroup = function () {
    if (!this.isActive() || this.cursor >= this.groups.length) return null;
    var index = this.cursor;
    this.groups[index].forEach(function (unit) { unit.classList.add("is-omitted"); });
    this.cursor += 1;
    return index;
  };

  WordSlide.prototype.omitAtGroup = function (groupIndex, level, paragraphGroupCount, allowIncomplete) {
    if (!this.groups[groupIndex]) return null;
    var targets = [];
    if (level === "character" || level === "word") {
      var blueUnits = this.blueInteractionUnits(groupIndex).filter(function (unit) {
        return this.isUnitVisibleForOmission(unit, allowIncomplete);
      }, this);
      if (blueUnits.length) {
        targets = blueUnits;
      }
      var word = targets.length ? null : this.groups[groupIndex].find(function (unit) {
        return unit.dataset.unitKind === "word"
          && this.isUnitVisibleForOmission(unit, allowIncomplete);
      }, this);
      if (!targets.length && !word) {
        word = this.groups[groupIndex].find(function (unit) {
          return this.isUnitVisibleForOmission(unit, allowIncomplete);
        }, this);
      }
      if (word) targets.push(word);
    } else {
      var groupCount = level === "paragraph" ? paragraphGroupCount : (level === "sentences" ? 2 : 1);
      var completedCount = 0;
      for (var candidate = groupIndex; candidate >= 0 && completedCount < groupCount; candidate -= 1) {
        if ((allowIncomplete || this.isGroupFullyRevealed(candidate))
            && this.hasVisibleOmittableContent(candidate, allowIncomplete)) {
          targets = targets.concat(this.groups[candidate].filter(function (unit) {
            return this.isUnitVisibleForOmission(unit, allowIncomplete);
          }, this));
          completedCount += 1;
        }
      }
    }
    targets = targets.filter(function (unit) {
      return this.isUnitVisibleForOmission(unit, allowIncomplete);
    }, this);
    if (!targets.length) return null;
    targets.forEach(function (unit, omissionIndex) {
      this.dropOmittedUnit(unit, omissionIndex);
    }, this);
    return { slide: this, units: targets, groupIndex: groupIndex, level: level };
  };

  WordSlide.prototype.restoreOmission = function (record) {
    if (!record || !record.units) return;
    record.units.forEach(function (unit) { record.slide.clearDroppedUnit(unit); });
  };

  WordSlide.prototype.restoreGroup = function (index) {
    if (!this.groups[index]) return;
    this.groups[index].forEach(function (unit) { this.clearDroppedUnit(unit); }, this);
    this.cursor = Math.min(this.cursor, index);
  };

  WordSlide.prototype.reset = function () {
    var transientRegionState = [
      "maxForwardProgress", "dependencyReadyAt", "fastStartAt", "fastEndAt",
      "voiceQueued", "voiceStartDelay", "voiceStartAt", "voiceEndAt",
      "typeRightStartAt", "typeRightDuration", "typeRightEndAt", "pinkImpactStartAt",
      "pinkAngryStartAt", "pinkAngryFollowupStartAt", "pinkBarrageStartAt",
      "dependencyRevealStartAt"
    ];
    this.data.markerRegions.forEach(function (region) {
      transientRegionState.forEach(function (key) { delete region[key]; });
    });
    this.slide1Sequence = null;
    this._pinkAngryInteractionComplete = false;
    this._pinkBarrageDirectScheduled = false;
    delete this._pinkAngryInteractionStartedAt;
    this.groups.forEach(function (group) {
      group.forEach(function (unit) {
        this.clearDroppedUnit(unit);
        if (unit._pinkTrembleAnimation) unit._pinkTrembleAnimation.cancel();
        if (unit._pinkBarrageAnimation) unit._pinkBarrageAnimation.cancel();
        unit._pinkTrembleAnimation = null;
        unit._pinkBarrageAnimation = null;
        unit._pinkTremblePlayed = false;
        unit.style.marginTop = "0px";
      }, this);
    }, this);
    this.cursor = 0;
  };

  global.WordSlide = WordSlide;
}(window));
