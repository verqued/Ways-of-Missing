(function (global) {
  "use strict";

  global.APP_CONFIG = Object.freeze({
    source: Object.freeze({
      width: 1920,
      height: 1080,
      slideCount: 19,
      glyphsPerRow: 20,
      sampleSlidesHidden: true,
    }),
    interaction: Object.freeze({
      minimumVisibleRatio: 0.18,
      // Preserve the old hand-tuned slide-1 code, but keep it dormant while
      // the replacement Illustrator slide follows the shared colour rules.
      legacySlide1InteractionsEnabled: false,
      blinkOmissionEnabled: true,
      // TODO(camera): Re-enable after the scroll interactions are finalized.
      cameraEnabled: true,
      idleOmissionPromptDelayMs: 30000,
    }),
    blink: Object.freeze({
      closeThreshold: 0.28,
      reopenThreshold: 0.16,
      calibrationOpenThreshold: 0.22,
      baselineCalibrationMs: 160,
      minimumClosedMs: 24,
      minimumOpenMs: 28,
      adaptiveAverageRise: 0.09,
      adaptivePeakRise: 0.15,
      strongCloseAverage: 0.48,
      strongClosePeak: 0.58,
      strongAdaptiveAverageRise: 0.18,
      strongAdaptivePeakRise: 0.28,
      baselineSmoothing: 0.035,
      contentCooldownMs: 120,
      incompleteOmissionAfterIdleMs: 4000,
      characterOmissionMaxMs: 500,
      wordOmissionMaxMs: 2000,
      sentenceOmissionMaxMs: 5000,
      paragraphOmissionMinMs: 10000,
      paragraphGroupCount: 3,
    }),
    scroll: Object.freeze({
      restoreHysteresisPx: 24,
      bottomEpsilonPx: 4,
      bottomHoldMs: 6000,
      inactivityMs: 120000,
      resetDurationMs: 1400,
    }),
    motion: Object.freeze({
      sentenceEnterXPercent: 28,
      sentenceEnterYPx: 22,
      sentenceExitYPx: -7,
      sentenceScrub: 0.95,
      sentenceStart: "top 90%",
      sentenceEnd: "top 34%",
      artboardEnterYPx: 6,
      artboardExitYPx: -4,
      artboardEnterScale: 1.002,
      artboardScrub: 1.65,
    }),
  });
}(window));
