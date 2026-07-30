// Identifies the target application the engine is automating.
//
// `wechat` and `wework` default to VLM layout measurement.
// The remaining values default to overlay wizard measurement.
export type AppType = 'wechat' | 'wework' | 'dingtalk' | 'lark' | 'slack' | 'telegram' | 'generic'

// Which capture strategy the engine should use.
// - `auto`: smart default — VLM for wechat/wework, overlay wizard for others.
// - `vlm`: force VLM layout measurement (only valid for wechat/wework).
// - `box-select`: force manual box selection via overlay wizard; opens the wizard if no regions
//   are saved yet.
export type CaptureStrategy = 'auto' | 'vlm' | 'box-select'

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

// Region rectangles drawn by the user during the overlay wizard.
// Coordinates are absolute screen pixels in logical units.
// capture sites multiply by `scaleFactor` for `desktopCapturer` cropping.
export interface BoxRegions {
  contactList: ScreenRect
  chatMain: ScreenRect
  inputBox: ScreenRect
  unreadIndicator: ScreenRect | null
  displayId?: number
  scaleFactor?: number
  capturedAt: number
}
