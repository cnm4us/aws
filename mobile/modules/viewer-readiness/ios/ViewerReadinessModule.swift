import AVFoundation
import CoreVideo
import ExpoModulesCore
import UIKit

// Exact paused-frame evidence for feed entry and the internal check. A decoded
// frame is not a pixel acknowledgement from AVPlayerViewController; physical
// full-height presentation qualification is recorded separately.
public final class ViewerReadinessModule: Module {
  private var request: ReadinessRequest?
  private var seeks: [String: TimelineSeekRequest] = [:]

  public func definition() -> ModuleDefinition {
    Name("ViewerReadiness")

    // Presentation geometry accounts for the item's displayed orientation.
    // Reading it does not seek, attach an output or change playback ownership.
    AsyncFunction("presentationSizeAsync") { (player: SharedRef<AVPlayer>) -> [String: Double] in
      let size = player.ref.currentItem?.presentationSize ?? .zero
      return ["width": size.width.isFinite ? Double(size.width) : 0,
              "height": size.height.isFinite ? Double(size.height) : 0]
    }.runOnQueue(.main)

    // Interactive seeks are independent of the decoded-frame entry probe.
    AsyncFunction("seekAsync") { (player: SharedRef<AVPlayer>, attempt: String, seconds: Double, promise: Promise) in
      guard seconds.isFinite, seconds >= 0, !attempt.isEmpty, attempt.count <= 80,
        UIApplication.shared.applicationState == .active,
        let item = player.ref.currentItem, item.status == .readyToPlay,
        player.ref.rate == 0, player.ref.isMuted else {
        promise.reject("ERR_SEEK_PRECONDITION", "A ready, paused and muted player is required.")
        return
      }
      for operation in Array(self.seeks.values) where operation.player === player.ref { operation.cancel("superseded") }
      let operation = TimelineSeekRequest(player: player.ref, item: item, attempt: attempt, seconds: seconds, promise: promise) { [weak self] ended in
        if self?.seeks[ended.attempt] === ended { self?.seeks.removeValue(forKey: ended.attempt) }
      }
      self.seeks[attempt] = operation
      operation.start()
    }.runOnQueue(.main)

    AsyncFunction("cancelSeekAsync") { (attempt: String) in
      self.seeks[attempt]?.cancel("cancelled")
    }.runOnQueue(.main)

    // ExpoVideo's internal VideoPlayer inherits this public cross-module type.
    // No registry IDs, reflection or changes to ExpoVideo are needed.
    AsyncFunction("prepareAsync") { (player: SharedRef<AVPlayer>, attempt: String, seconds: Double, promise: Promise) in
      self.cancelCurrent("superseded")
      guard seconds.isFinite, seconds >= 0, !attempt.isEmpty, attempt.count <= 80,
        UIApplication.shared.applicationState == .active,
        let item = player.ref.currentItem, item.status == .readyToPlay,
        player.ref.rate == 0, player.ref.isMuted else {
        promise.reject("ERR_READINESS_PRECONDITION", "A current, ready, muted and paused player is required.")
        return
      }
      let operation = ReadinessRequest(player: player.ref, item: item, attempt: attempt, seconds: seconds, promise: promise) { [weak self] ended in
        if self?.request === ended { self?.request = nil }
      }
      self.request = operation
      operation.start()
    }.runOnQueue(.main)

    AsyncFunction("cancelAsync") { (attempt: String) in
      if self.request?.attempt == attempt { self.cancelCurrent("cancelled") }
    }.runOnQueue(.main)

    OnAppEntersBackground {
      DispatchQueue.main.async { self.cancelCurrent("background") }
    }

    OnDestroy {
      DispatchQueue.main.async { self.cancelCurrent("destroyed") }
    }
  }

  private func cancelCurrent(_ reason: String) {
    for operation in Array(seeks.values) { operation.cancel(reason) }
    request?.cancel(reason)
    request = nil
  }
}

// All methods and AVPlayer operations run on main; the timer and seek callback
// are attempt-bound. Only one output can be attached by this module at a time.
private final class ReadinessRequest {
  let attempt: String
  private let player: AVPlayer
  private let item: AVPlayerItem
  private let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
  ])
  private let seconds: Double
  private var promise: Promise?
  private var timer: Timer?
  private var seekCompletedMs: Double?
  private let onEnd: (ReadinessRequest) -> Void
  private let started = ProcessInfo.processInfo.systemUptime

  init(player: AVPlayer, item: AVPlayerItem, attempt: String, seconds: Double, promise: Promise, onEnd: @escaping (ReadinessRequest) -> Void) {
    self.player = player
    self.item = item
    self.attempt = attempt
    self.seconds = seconds
    self.promise = promise
    self.onEnd = onEnd
  }

  func start() {
    item.add(output)
    timer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in self?.poll() }
    let time = CMTime(seconds: seconds, preferredTimescale: 600)
    player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
      DispatchQueue.main.async {
        guard let self, self.promise != nil else { return }
        guard finished else { self.cancel("seek_interrupted"); return }
        self.seekCompletedMs = self.elapsedMs
        self.poll()
      }
    }
  }

  private var elapsedMs: Double { (ProcessInfo.processInfo.systemUptime - started) * 1000 }

  private func poll() {
    guard promise != nil else { return }
    guard UIApplication.shared.applicationState == .active, player.currentItem === item else {
      cancel("invalidated"); return
    }
    guard player.isMuted, player.rate == 0 else { cancel("unexpected_playback"); return }
    guard item.status != .failed else { cancel("source_failed"); return }
    guard elapsedMs < 8000 else { cancel("native_timeout"); return }
    guard let seekMs = seekCompletedMs else { return }
    let timeline = player.currentTime().seconds
    guard timeline.isFinite, abs(timeline - seconds) <= 0.1 else { return }
    var displayedAt = CMTime.invalid
    // Do not use `hasNewPixelBuffer` as a requirement: the item stays paused.
    guard let frame = output.copyPixelBuffer(
      forItemTime: CMTime(seconds: seconds, preferredTimescale: 600), itemTimeForDisplay: &displayedAt
    ) else { return }
    let frameTime = displayedAt.seconds
    // Reject stale pre-seek/other-time frames; never export the frame itself.
    guard frameTime.isFinite, abs(frameTime - seconds) <= 0.1 else { return }
    let result: [String: Any] = [
      "attempt": attempt, "kind": "target_decoded", "targetSeconds": seconds,
      "timelineSeconds": timeline, "decodedFrameSeconds": frameTime,
      "seekCompletedMs": seekMs, "decodedFrameMs": elapsedMs,
      "width": CVPixelBufferGetWidth(frame), "height": CVPixelBufferGetHeight(frame),
      "muted": player.isMuted, "rate": player.rate
    ]
    let completion = promise
    cleanup()
    completion?.resolve(result)
  }

  func cancel(_ reason: String) {
    let completion = promise
    cleanup()
    completion?.reject("ERR_READINESS_\(reason.uppercased())", "Readiness check ended: \(reason).")
  }

  private func cleanup() {
    timer?.invalidate()
    timer = nil
    if item.outputs.contains(where: { $0 === output }) { item.remove(output) }
    promise = nil
    onEnd(self)
  }
}

// Completion comes from AVPlayer, not from the JS currentTime setter. No frame
// output is attached; displayed pixels still require physical qualification.
private final class TimelineSeekRequest {
  let player: AVPlayer
  let attempt: String
  private let item: AVPlayerItem
  private let seconds: Double
  private var promise: Promise?
  private var timer: Timer?
  private let onEnd: (TimelineSeekRequest) -> Void
  private let started = ProcessInfo.processInfo.systemUptime

  init(player: AVPlayer, item: AVPlayerItem, attempt: String, seconds: Double, promise: Promise, onEnd: @escaping (TimelineSeekRequest) -> Void) {
    self.player = player; self.item = item; self.attempt = attempt; self.seconds = seconds; self.promise = promise; self.onEnd = onEnd
  }
  func start() {
    timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
      guard let self, self.promise != nil else { return }
      if ProcessInfo.processInfo.systemUptime - self.started >= 8 || self.player.currentItem !== self.item ||
        UIApplication.shared.applicationState != .active || self.item.status == .failed || !self.player.isMuted || self.player.rate != 0 {
        self.cancel("interrupted")
      }
    }
    player.seek(to: CMTime(seconds: seconds, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] finished in
      DispatchQueue.main.async {
        guard let self, self.promise != nil else { return }
        let actual = self.player.currentTime().seconds
        guard finished, self.player.currentItem === self.item, self.item.status == .readyToPlay, actual.isFinite, abs(actual - self.seconds) <= 0.1,
          UIApplication.shared.applicationState == .active, self.player.isMuted, self.player.rate == 0 else { self.cancel("interrupted"); return }
        let completion = self.promise
        self.cleanup()
        completion?.resolve(actual)
      }
    }
  }
  func cancel(_ reason: String) {
    guard let completion = promise else { return }
    cleanup()
    item.cancelPendingSeeks()
    completion.reject("ERR_SEEK_\(reason.uppercased())", "Video seek ended: \(reason).")
  }
  private func cleanup() { timer?.invalidate(); timer = nil; promise = nil; onEnd(self) }
}
