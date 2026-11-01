import Foundation
import Capacitor
import UIKit
import Vision

/**
 * Minimal local Capacitor plugin that reads the text on a photo of a bathroom scale's display
 * with Apple's on-device Vision framework — no network, no model in the bundle. It only
 * returns what it saw; picking the weight out of it is lib/scale-reading.js, which has tests.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const ScaleReader = registerPlugin('ScaleReader');
 *   const { lines } = await ScaleReader.read({ image: '<base64 jpeg/png, no data: prefix>' });
 *   // lines: [{ text, confidence, height }] — height is the line's share of the image height,
 *   // so the big digits of the display stand out from the brand name and the small print.
 *
 * Capacitor 7 only auto-loads the plugins named in capacitor.config.json's packageClassList,
 * which `cap sync` rewrites from npm packages, so this one is registered by MainViewController.
 */
@objc(ScaleReaderPlugin)
public class ScaleReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ScaleReaderPlugin"
    public let jsName = "ScaleReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise)
    ]

    @objc func read(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data),
              let cgImage = image.cgImage else {
            call.reject("image is required")
            return
        }

        let request = VNRecognizeTextRequest { request, error in
            if let error = error {
                call.reject("text recognition failed", nil, error)
                return
            }
            var lines: [[String: Any]] = []
            for observation in (request.results as? [VNRecognizedTextObservation]) ?? [] {
                // A few candidates per line: a seven-segment "8" read as "B" in the first guess
                // is often a plain digit in the second.
                for candidate in observation.topCandidates(3) {
                    lines.append([
                        "text": candidate.string,
                        "confidence": Double(candidate.confidence),
                        "height": Double(observation.boundingBox.height)
                    ])
                }
            }
            call.resolve(["lines": lines])
        }
        request.recognitionLevel = .accurate
        // Digits, not words: language correction would turn "92.4" into something it knows.
        request.usesLanguageCorrection = false

        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try VNImageRequestHandler(cgImage: cgImage, orientation: orientation).perform([request])
            } catch {
                call.reject("text recognition failed", nil, error)
            }
        }
    }
}

private extension CGImagePropertyOrientation {
    // A photo from the camera keeps its pixels in sensor order and says how to turn them; Vision
    // needs to be told the same, or a portrait shot is read lying on its side.
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
