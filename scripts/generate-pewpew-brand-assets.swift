import AppKit

extension NSColor {
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: alpha
        )
    }
}

func savePNG(_ image: NSImage, to url: URL) throws {
    guard
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let data = rep.representation(using: .png, properties: [:])
    else {
        throw NSError(domain: "PewPewBrandAssets", code: 1)
    }
    try data.write(to: url)
}

func saveJPEG(_ image: NSImage, to url: URL) throws {
    guard
        let tiff = image.tiffRepresentation,
        let rep = NSBitmapImageRep(data: tiff),
        let data = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.92])
    else {
        throw NSError(domain: "PewPewBrandAssets", code: 2)
    }
    try data.write(to: url)
}

func drawText(
    _ text: String,
    in rect: NSRect,
    font: NSFont,
    color: NSColor,
    alignment: NSTextAlignment = .left
) {
    let style = NSMutableParagraphStyle()
    style.alignment = alignment
    (text as NSString).draw(
        in: rect,
        withAttributes: [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: style,
        ]
    )
}

func makeIcon() -> NSImage {
    let size = NSSize(width: 1024, height: 1024)
    let sourceURL = root.appendingPathComponent("assets/branding/pewpew-logo-source.jpg")
    return NSImage(size: size, flipped: false) { rect in
        NSColor.clear.setFill()
        rect.fill()

        guard let source = NSImage(contentsOf: sourceURL) else {
            return false
        }

        let inset = source.size.width * 0.045
        let sourceRect = NSRect(
            x: inset,
            y: inset,
            width: source.size.width - inset * 2,
            height: source.size.height - inset * 2
        )
        NSBezierPath(roundedRect: rect, xRadius: 226, yRadius: 226).addClip()
        source.draw(in: rect, from: sourceRect, operation: .sourceOver, fraction: 1)
        return true
    }
}

func makeHeaderLogo() -> NSImage {
    let size = NSSize(width: 1024, height: 1024)
    let sourceURL = root.appendingPathComponent("assets/branding/pewpew-logo-source.jpg")
    return NSImage(size: size, flipped: false) { rect in
        NSColor.white.setFill()
        rect.fill()

        guard let source = NSImage(contentsOf: sourceURL) else {
            return false
        }

        let inset = source.size.width * 0.045
        let sourceRect = NSRect(
            x: inset,
            y: inset,
            width: source.size.width - inset * 2,
            height: source.size.height - inset * 2
        )
        source.draw(in: rect, from: sourceRect, operation: .sourceOver, fraction: 1)
        return true
    }
}

func makeDMGBackground() -> NSImage {
    let size = NSSize(width: 660, height: 400)
    return NSImage(size: size, flipped: true) { rect in
        NSGradient(colors: [
            NSColor(hex: 0xf7fbff),
            NSColor(hex: 0xeef6ff),
            NSColor(hex: 0xe7f0ff),
        ])?.draw(in: rect, angle: 140)

        NSColor(hex: 0x2f7dff, alpha: 0.08).setFill()
        NSBezierPath(ovalIn: NSRect(x: -18, y: -52, width: 196, height: 196)).fill()
        NSColor(hex: 0x07c160, alpha: 0.07).setFill()
        NSBezierPath(ovalIn: NSRect(x: 484, y: 244, width: 276, height: 276)).fill()

        drawText(
            "PewPew 云客户端",
            in: NSRect(x: 40, y: 36, width: 420, height: 36),
            font: NSFont.systemFont(ofSize: 28, weight: .heavy),
            color: NSColor(hex: 0x10203f)
        )

        let arrow = NSBezierPath()
        arrow.move(to: NSPoint(x: 252, y: 184))
        arrow.curve(
            to: NSPoint(x: 408, y: 184),
            controlPoint1: NSPoint(x: 294, y: 158),
            controlPoint2: NSPoint(x: 366, y: 158)
        )
        NSColor(hex: 0x2f7dff, alpha: 0.78).setStroke()
        arrow.lineWidth = 8
        arrow.lineCapStyle = .round
        arrow.stroke()

        let arrowHead = NSBezierPath()
        arrowHead.move(to: NSPoint(x: 394, y: 164))
        arrowHead.line(to: NSPoint(x: 416, y: 185))
        arrowHead.line(to: NSPoint(x: 388, y: 196))
        NSColor(hex: 0x2f7dff).setStroke()
        arrowHead.lineWidth = 8
        arrowHead.lineCapStyle = .round
        arrowHead.lineJoinStyle = .round
        arrowHead.stroke()

        drawText(
            "拖入 Applications 文件夹完成安装 / Drag to Applications to install",
            in: NSRect(x: 42, y: 322, width: 576, height: 30),
            font: NSFont.systemFont(ofSize: 16, weight: .heavy),
            color: NSColor(hex: 0x10203f),
            alignment: .center
        )

        return true
    }
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let iconURL = root.appendingPathComponent("assets/branding/pewpew-app-icon-1024.png")
let headerLogoURL = root.appendingPathComponent("src/assets/pewpew-logo.jpg")
let backgroundURL = root.appendingPathComponent("src-tauri/images/background.png")

try FileManager.default.createDirectory(
    at: iconURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
)
try savePNG(makeIcon(), to: iconURL)
try saveJPEG(makeHeaderLogo(), to: headerLogoURL)
try savePNG(makeDMGBackground(), to: backgroundURL)

print("Generated \(iconURL.path)")
print("Generated \(headerLogoURL.path)")
print("Generated \(backgroundURL.path)")
