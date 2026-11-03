import {join} from 'node:path';
export function customPaths(root){const directory=join(root,'CUSTOM');return {comfyKeyFile:join(directory,'REFERENCE_MASTER_COMFY_KEY.txt'),promptPresetDir:directory};}
