// MAIN-world entry (built to dist/bridge.js and injected with world MAIN at document_idle).
import { startBridge } from './bridge';

startBridge(window);
