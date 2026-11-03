import {createHash} from 'node:crypto';
export const keyFingerprint=key=>key?createHash('sha256').update(key).digest('hex'):undefined;
