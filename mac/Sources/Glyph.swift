import AppKit

// The open book from web/icon.svg, drawn from the same path so the menu bar and the site match.
enum Glyph {
    // The path in the SVG's 64-unit box, y pointing down.
    static func book() -> NSBezierPath {
        let path = NSBezierPath()
        path.move(to: NSPoint(x: 12, y: 18))
        path.curve(to: NSPoint(x: 32, y: 20), controlPoint1: NSPoint(x: 19, y: 15), controlPoint2: NSPoint(x: 26, y: 16))
        path.curve(to: NSPoint(x: 52, y: 18), controlPoint1: NSPoint(x: 38, y: 16), controlPoint2: NSPoint(x: 45, y: 15))
        path.line(to: NSPoint(x: 52, y: 46))
        path.curve(to: NSPoint(x: 32, y: 48), controlPoint1: NSPoint(x: 45, y: 43), controlPoint2: NSPoint(x: 38, y: 44))
        path.curve(to: NSPoint(x: 12, y: 46), controlPoint1: NSPoint(x: 26, y: 44), controlPoint2: NSPoint(x: 19, y: 43))
        path.close()
        path.move(to: NSPoint(x: 32, y: 20))
        path.line(to: NSPoint(x: 32, y: 48))
        path.lineJoinStyle = .round
        return path
    }

    static func placed(scale: CGFloat, center: NSPoint) -> NSBezierPath {
        let path = book()
        let transform = NSAffineTransform()
        transform.translateX(by: center.x, yBy: center.y)
        transform.scale(by: scale)
        transform.translateX(by: -32, yBy: -32)
        path.transform(using: transform as AffineTransform)
        return path
    }

    // A template image, so macOS colors it for light and dark menu bars. Dimmed while a sync runs,
    // with a dot when something needs the reader.
    static func menuBar(dimmed: Bool = false, badge: Bool = false) -> NSImage {
        let image = NSImage(size: NSSize(width: 20, height: 18), flipped: true) { _ in
            let alpha: CGFloat = dimmed ? 0.45 : 1
            let path = placed(scale: 0.37, center: NSPoint(x: 10, y: 9.5))
            path.lineWidth = 1.6
            NSColor.black.withAlphaComponent(alpha).setStroke()
            path.stroke()
            if badge {
                let hole = NSBezierPath(ovalIn: NSRect(x: 13, y: 0.5, width: 7, height: 7))
                NSGraphicsContext.current?.compositingOperation = .clear
                hole.fill()
                NSGraphicsContext.current?.compositingOperation = .sourceOver
                NSColor.black.setFill()
                NSBezierPath(ovalIn: NSRect(x: 14.25, y: 1.75, width: 4.5, height: 4.5)).fill()
            }
            return true
        }
        image.isTemplate = true
        return image
    }

    // The app icon at 1024 pixels, on the macOS icon grid (an 824-pixel tile with a 100-pixel margin).
    static func appIcon() -> NSBitmapImageRep {
        let size = 1024
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8, samplesPerPixel: 4,
                                      hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        NSGraphicsContext.saveGraphicsState()
        let context = NSGraphicsContext(bitmapImageRep: bitmap)!
        NSGraphicsContext.current = context
        // Flip so the SVG's y-down coordinates draw the right way up.
        context.cgContext.translateBy(x: 0, y: CGFloat(size))
        context.cgContext.scaleBy(x: 1, y: -1)
        NSColor(srgbRed: 252 / 255, green: 82 / 255, blue: 0, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185).fill()
        let path = placed(scale: 824 / 64, center: NSPoint(x: 512, y: 512))
        path.lineWidth = 4 * 824 / 64
        NSColor.white.setStroke()
        path.stroke()
        NSGraphicsContext.restoreGraphicsState()
        return bitmap
    }
}
