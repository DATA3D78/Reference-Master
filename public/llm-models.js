// Verified against https://openrouter.ai/api/v1/models on 2026-10-07.
// Batch aliases use a separate asynchronous API and are not distinct models.
export const LLM_MODELS=[
  {
    "id": "openai/gpt-5.6-sol",
    "name": "GPT-5.6 Sol",
    "inputPrice": 2.0,
    "outputPrice": 10.0
  },
  {
    "id": "openai/gpt-5.6-sol-pro",
    "name": "GPT-5.6 Sol Pro",
    "inputPrice": 2.0,
    "outputPrice": 10.0
  },
  {
    "id": "openai/gpt-5.6-terra",
    "name": "GPT-5.6 Terra",
    "inputPrice": 2.0,
    "outputPrice": 12.0
  },
  {
    "id": "openai/gpt-5.6-terra-pro",
    "name": "GPT-5.6 Terra Pro",
    "inputPrice": 2.0,
    "outputPrice": 12.0
  },
  {
    "id": "openai/gpt-5.6-luna",
    "name": "GPT-5.6 Luna",
    "inputPrice": 0.19999999999999998,
    "outputPrice": 1.2
  },
  {
    "id": "openai/gpt-5.6-luna-pro",
    "name": "GPT-5.6 Luna Pro",
    "inputPrice": 0.19999999999999998,
    "outputPrice": 1.2
  },
  {
    "id": "openai/gpt-6-astra",
    "name": "GPT-6 Astra",
    "inputPrice": 10.0,
    "outputPrice": 50.0
  },
  {
    "id": "openai/gpt-6-astra-pro",
    "name": "GPT-6 Astra Pro",
    "inputPrice": 10.0,
    "outputPrice": 50.0
  }
];
export const LLM_LIMITS={images:8,frames:48,videoSeconds:600,videoMB:200,imageMB:10};
export function videoTimestamps(duration,count){
  if(!Number.isFinite(duration)||duration<=0||duration>LLM_LIMITS.videoSeconds||![12,24,48].includes(count))throw Error("Choose a video up to 10 minutes and 12, 24 or 48 frames.");
  const end=Math.max(0,duration-Math.min(.05,duration/10));
  return Array.from({length:count},(_,i)=>end*i/(count-1));
}
