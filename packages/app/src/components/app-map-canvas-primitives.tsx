/** Stable import surface for canvas presentation pieces. Implementations live
 * beside the product concept they render so cards, navigation, and inspectors
 * can evolve without rebuilding one canvas monolith. */
export { CanvasCombineCard, CanvasNoteCard, ScreenCard } from "./app-map-canvas-cards";
export { KeyboardConnectionChooser } from "./app-map-connection-chooser";
export { ConnectionInspector, GroupInspector, ScreenInspector } from "./app-map-canvas-inspectors";
