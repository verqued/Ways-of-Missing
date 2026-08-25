(function (global) {
  "use strict";

  function BlinkDetector(config) {
    this.config = config;
    this.faceLandmarker = null;
    this.stream = null;
    this.video = null;
    this.running = false;
    this.frameRequest = 0;
    this.lastVideoTime = -1;
    this.closedSince = null;
    this.openSince = null;
    this.phase = "SEEK_OPEN";
    this.onBlink = function () {};
    this.onOpenProgress = function () {};
    this.openStartedAt = null;
    this.openBaselineLeft = null;
    this.openBaselineRight = null;
    this.predict = this.predict.bind(this);
  }

  BlinkDetector.prototype.createDetector = async function () {
    var visionBundle = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/vision_bundle.mjs");
    var vision = await visionBundle.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm"
    );
    return visionBundle.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      minFaceDetectionConfidence: 0.45,
      minFacePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    });
  };

  BlinkDetector.prototype.start = async function (video, handlers) {
    this.video = video;
    this.onBlink = handlers.onBlink || this.onBlink;
    this.onOpenProgress = handlers.onOpenProgress || this.onOpenProgress;
    this.phase = "SEEK_OPEN";
    this.closedSince = null;
    this.openSince = null;
    this.openStartedAt = null;
    this.openBaselineLeft = null;
    this.openBaselineRight = null;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    this.faceLandmarker = await this.createDetector();
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.predict();
  };

  BlinkDetector.prototype.detectBlink = function (result, now) {
    var categories = result.faceBlendshapes && result.faceBlendshapes[0]
      ? result.faceBlendshapes[0].categories || []
      : [];
    if (!categories.length) {
      this.phase = "SEEK_OPEN";
      this.closedSince = null;
      this.openSince = null;
      this.openStartedAt = null;
      this.openBaselineLeft = null;
      this.openBaselineRight = null;
      return;
    }
    var scores = {};
    categories.forEach(function (item) {
      scores[item.categoryName] = item.score;
    });

    var leftBlink = scores.eyeBlinkLeft || 0;
    var rightBlink = scores.eyeBlinkRight || 0;

    if (this.phase === "SEEK_OPEN") {
      var calibrationOpen = leftBlink < this.config.blink.calibrationOpenThreshold
        && rightBlink < this.config.blink.calibrationOpenThreshold;
      if (!calibrationOpen) {
        this.openSince = null;
        this.openBaselineLeft = null;
        this.openBaselineRight = null;
        return;
      }
      if (this.openSince === null) {
        this.openSince = now;
        this.openBaselineLeft = leftBlink;
        this.openBaselineRight = rightBlink;
      } else {
        this.openBaselineLeft += (leftBlink - this.openBaselineLeft) * 0.2;
        this.openBaselineRight += (rightBlink - this.openBaselineRight) * 0.2;
      }
      if (now - this.openSince >= this.config.blink.baselineCalibrationMs) {
        this.phase = "OPEN";
        this.openStartedAt = now;
        this.openSince = null;
      }
      return;
    }

    var blinkAverage = (leftBlink + rightBlink) / 2;
    var blinkPeak = Math.max(leftBlink, rightBlink);
    var leftRise = Math.max(0, leftBlink - this.openBaselineLeft);
    var rightRise = Math.max(0, rightBlink - this.openBaselineRight);
    var averageRise = (leftRise + rightRise) / 2;
    var peakRise = Math.max(leftRise, rightRise);
    var absoluteClosed = blinkAverage > this.config.blink.closeThreshold
      && blinkPeak > this.config.blink.closeThreshold + 0.08;
    var adaptiveClosed = averageRise > this.config.blink.adaptiveAverageRise
      && peakRise > this.config.blink.adaptivePeakRise;
    var closed = absoluteClosed || adaptiveClosed;
    var strongClosed = (
      blinkAverage > this.config.blink.strongCloseAverage
      && blinkPeak > this.config.blink.strongClosePeak
    ) || (
      averageRise > this.config.blink.strongAdaptiveAverageRise
      && peakRise > this.config.blink.strongAdaptivePeakRise
    );
    var reopened = (
      leftBlink < this.config.blink.reopenThreshold
      && rightBlink < this.config.blink.reopenThreshold
    ) || (averageRise < 0.035 && peakRise < 0.065);

    if (this.phase === "OPEN" && !closed && averageRise < 0.06) {
      var smoothing = this.config.blink.baselineSmoothing;
      this.openBaselineLeft += (leftBlink - this.openBaselineLeft) * smoothing;
      this.openBaselineRight += (rightBlink - this.openBaselineRight) * smoothing;
    }

    if (this.phase === "OPEN" && closed) {
      if (this.closedSince === null) this.closedSince = now;
      if (strongClosed || now - this.closedSince >= this.config.blink.minimumClosedMs) {
        this.phase = "WAIT_REOPEN";
        this.closedSince = null;
        this.openSince = null;
        this.onBlink({
          timestamp: now,
          openDurationMs: this.openStartedAt === null ? 0 : now - this.openStartedAt,
        });
        this.openStartedAt = null;
      }
      return;
    }

    if (this.phase === "OPEN") {
      this.closedSince = null;
      this.onOpenProgress({
        timestamp: now,
        durationMs: this.openStartedAt === null ? 0 : now - this.openStartedAt,
      });
      return;
    }

    if (this.phase === "WAIT_REOPEN") {
      if (!reopened) {
        this.openSince = null;
        return;
      }
      if (this.openSince === null) this.openSince = now;
      if (now - this.openSince >= this.config.blink.minimumOpenMs) {
        this.phase = "OPEN";
        this.openStartedAt = now;
        this.openSince = null;
      }
    }
  };

  BlinkDetector.prototype.predict = function () {
    if (!this.running) return;
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastVideoTime = this.video.currentTime;
      var now = performance.now();
      try {
        this.detectBlink(this.faceLandmarker.detectForVideo(this.video, now), now);
      } catch (error) {
        this.phase = "SEEK_OPEN";
        this.closedSince = null;
        this.openSince = null;
        this.openStartedAt = null;
        this.openBaselineLeft = null;
        this.openBaselineRight = null;
      }
    }
    this.frameRequest = global.requestAnimationFrame(this.predict);
  };

  BlinkDetector.prototype.stop = function () {
    this.running = false;
    global.cancelAnimationFrame(this.frameRequest);
    if (this.stream) {
      this.stream.getTracks().forEach(function (track) { track.stop(); });
    }
    if (this.faceLandmarker && this.faceLandmarker.close) this.faceLandmarker.close();
    this.stream = null;
    this.faceLandmarker = null;
  };

  global.BlinkDetector = BlinkDetector;
}(window));
