import AppKit

// Renders the app icon to a PNG at build time: swiftc mac/icon/main.swift mac/Sources/Glyph.swift
guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: icon <out.png>\n".utf8))
    exit(1)
}
let png = Glyph.appIcon().representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
