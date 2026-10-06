import { ShardEngine } from '../engine/pipeline/shardEngine';
import { attachEngineToWorkerScope } from '../engine/pipeline/pool';
import { loadPdfJsInWorker } from '../lib/pdfjsLoader';

const engine = new ShardEngine({ loadPdfJs: loadPdfJsInWorker });
attachEngineToWorkerScope(self as unknown as Parameters<typeof attachEngineToWorkerScope>[0], engine);
