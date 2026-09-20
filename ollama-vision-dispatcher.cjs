const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const allowedDecision = new Set(['pass', 'reinspect', 'dispatch-to-codex']);
const allowedCategory = new Set(['geometry', 'material', 'lighting', 'reflection', 'ocean', 'atmosphere', 'vegetation', 'city', 'aircraft', 'performance', 'unknown']);
const allowedSeverity = new Set(['low', 'medium', 'high', 'blocking']);
const topLevelKeys = new Set(['observationId', 'decision', 'summary', 'defects']);
const defectKeys = new Set(['category', 'severity', 'confidence', 'description', 'pixel', 'objectId', 'semantic', 'module', 'evidence', 'recommendedAction']);

function stripDataUrl(value) {
  if (typeof value !== 'string') throw new Error('RGB sensor did not return an image');
  const comma = value.indexOf(',');
  return comma >= 0 ? value.slice(comma + 1) : value;
}

function durationMs(value) {
  return typeof value === 'number' ? Number((value / 1e6).toFixed(1)) : null;
}

function modelMetrics(response, wallMs) {
  const evalDurationSeconds = (response.eval_duration ?? 0) / 1e9;
  return {
    wallMs,
    totalMs: durationMs(response.total_duration),
    loadMs: durationMs(response.load_duration),
    promptEvalMs: durationMs(response.prompt_eval_duration),
    evalMs: durationMs(response.eval_duration),
    promptTokens: response.prompt_eval_count ?? null,
    outputTokens: response.eval_count ?? null,
    outputTokensPerSecond: evalDurationSeconds > 0 && response.eval_count
      ? Number((response.eval_count / evalDurationSeconds).toFixed(2))
      : null,
    doneReason: response.done_reason ?? null,
  };
}

function knownObjects(observation, center) {
  const objects = new Map();
  for (const object of observation.nearby ?? []) objects.set(Number(object.id), object);
  if (center?.object?.id) objects.set(Number(center.object.id), center.object);
  return objects;
}

function applySensorDeltaGate(finding, observation, context, policy) {
  const settings = policy.sensorDeltaGate;
  const baseline = context.baselineSensorStatistics;
  const current = observation.visual?.passes?.rgb;
  if (!settings?.enabled || !baseline || !current) return { evaluated: false, applied: false };
  const meanLuminanceDelta = Number(Math.abs((current.meanLuminance ?? 0) - (baseline.meanLuminance ?? 0)).toFixed(2));
  const luminanceStdDevDelta = Number(Math.abs((current.luminanceStdDev ?? 0) - (baseline.luminanceStdDev ?? 0)).toFixed(2));
  const significant = meanLuminanceDelta >= settings.meanLuminanceThreshold || luminanceStdDevDelta >= settings.luminanceStdDevThreshold;
  const modelDecision = finding.decision;
  if (significant && modelDecision === 'pass') {
    finding.decision = settings.decision === 'dispatch-to-codex' ? 'dispatch-to-codex' : 'reinspect';
    finding.summary = `Контроллер обнаружил значительное расхождение RGB-метрик с эталоном. ${finding.summary}`;
    finding.defects.push({
      category: 'unknown',
      severity: 'high',
      confidence: 1,
      description: 'RGB-кадр заметно отличается от эталонного состояния, хотя визуальная модель вернула pass.',
      pixel: null,
      objectId: null,
      semantic: null,
      module: null,
      evidence: [`meanLuminance delta: ${meanLuminanceDelta}`, `luminanceStdDev delta: ${luminanceStdDevDelta}`],
      recommendedAction: 'Повторить осмотр с другим ракурсом и проверить объектные данные до изменения кода.',
    });
  }
  return { evaluated: true, applied: significant && modelDecision === 'pass', significant, modelDecision, meanLuminanceDelta, luminanceStdDevDelta };
}

function validateFinding(value, expectedObservationId, objects, policy) {
  const errors = [];
  const corrections = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { errors: ['Response must be a JSON object'], corrections };
  for (const key of Object.keys(value)) if (!topLevelKeys.has(key)) errors.push(`Unsupported top-level property: ${key}`);
  if (value.observationId !== expectedObservationId) {
    corrections.push(`observationId replaced with ${expectedObservationId}`);
    value.observationId = expectedObservationId;
  }
  if (!allowedDecision.has(value.decision)) errors.push('Invalid decision');
  if (typeof value.summary !== 'string' || value.summary.trim().length < 1 || value.summary.length > 1000) errors.push('Invalid summary');
  if (!Array.isArray(value.defects) || value.defects.length > 20) errors.push('Invalid defects array');
  if (!Array.isArray(value.defects)) value.defects = [];

  value.defects.forEach((defect, index) => {
    const prefix = `defects[${index}]`;
    if (!defect || typeof defect !== 'object' || Array.isArray(defect)) { errors.push(`${prefix} must be an object`); return; }
    for (const field of ['pixel', 'objectId', 'semantic', 'module']) {
      if (defect[field] === undefined) defect[field] = null;
    }
    for (const key of Object.keys(defect)) if (!defectKeys.has(key)) errors.push(`${prefix} has unsupported property: ${key}`);
    if (!allowedCategory.has(defect.category)) errors.push(`${prefix}.category is invalid`);
    if (!allowedSeverity.has(defect.severity)) errors.push(`${prefix}.severity is invalid`);
    if (typeof defect.confidence !== 'number' || defect.confidence < 0 || defect.confidence > 1) errors.push(`${prefix}.confidence is invalid`);
    for (const field of ['description', 'recommendedAction']) if (typeof defect[field] !== 'string' || !defect[field].trim()) errors.push(`${prefix}.${field} is required`);
    if (!Array.isArray(defect.evidence) || defect.evidence.length < 1 || defect.evidence.some(item => typeof item !== 'string' || !item.trim())) errors.push(`${prefix}.evidence is invalid`);
    if (defect.pixel != null && (!Number.isInteger(defect.pixel.x) || !Number.isInteger(defect.pixel.y) || defect.pixel.x < 0 || defect.pixel.y < 0)) errors.push(`${prefix}.pixel is invalid`);
    if (defect.objectId != null) {
      if (!Number.isInteger(defect.objectId) || defect.objectId < 1) errors.push(`${prefix}.objectId is invalid`);
      else if (!objects.has(defect.objectId)) {
        corrections.push(`${prefix}.objectId ${defect.objectId} removed because it is absent from the observation catalog`);
        defect.objectId = null;
        defect.semantic = null;
        defect.module = null;
      } else {
        const known = objects.get(defect.objectId);
        if (defect.semantic !== known.semantic) {
          corrections.push(`${prefix}.semantic aligned with object ${defect.objectId}`);
          defect.semantic = known.semantic ?? null;
        }
        if (defect.module !== known.module) {
          corrections.push(`${prefix}.module aligned with object ${defect.objectId}`);
          defect.module = known.module ?? null;
        }
      }
    }
    for (const field of ['semantic', 'module']) if (defect[field] !== null && typeof defect[field] !== 'string') errors.push(`${prefix}.${field} is invalid`);
  });

  if (value.decision === 'pass' && value.defects.length > 0) {
    corrections.push('decision changed to dispatch-to-codex because defects were returned');
    value.decision = 'dispatch-to-codex';
  }
  if (value.decision === 'dispatch-to-codex' && value.defects.length === 0) errors.push('dispatch-to-codex requires at least one defect');
  const threshold = policy.minimumConfidenceForAutomaticDispatch ?? 0.65;
  const unsupported = value.defects.some(defect => defect.confidence >= threshold && defect.objectId == null && !defect.module);
  if (policy.requireObjectOrModuleEvidence && value.decision === 'dispatch-to-codex' && unsupported) {
    corrections.push('decision changed to reinspect because a confident defect lacks object or module evidence');
    value.decision = 'reinspect';
  }
  return { errors, corrections };
}

function buildPrompt(observationId, observation, context, center, hasReference = false) {
  const nearby = (observation.nearby ?? []).slice(0, 40).map(object => ({
    id: object.id,
    name: object.name,
    semantic: object.semantic,
    module: object.module,
    position: object.position,
  }));
  const passes = Object.fromEntries(Object.entries(observation.visual?.passes ?? {}).map(([name, pass]) => [name, {
    width: pass.width,
    height: pass.height,
    meanLuminance: pass.meanLuminance,
    luminanceStdDev: pass.luminanceStdDev,
  }]));
  return [
    hasReference
      ? 'Сравни два RGB-кадра Flight World: изображение 1 — исправный эталон, изображение 2 — текущее состояние. Ищи нежелательные отличия на втором изображении.'
      : 'Проанализируй RGB-кадр Flight World вместе со структурированными данными.',
    'Верни только JSON по заданной схеме. Не добавляй markdown.',
    'Не придумывай objectId, semantic или module: используй только значения из каталога объектов.',
    'В defects добавляй только реально видимую нежелательную аномалию. Ожидаемый дождь, снег, туман, темнота, блики, отражения, цвет заката и снижение детализации вдали не являются дефектами.',
    'Если всё выглядит нормально, обязательно выбери pass и верни defects: []. Не создавай запись о том, что эффект корректен.',
    'Выбирай reinspect только когда видна возможная аномалия, но текущего кадра недостаточно для решения. Тогда кратко опиши именно подозрительную аномалию.',
    'Если видимую аномалию нельзя уверенно связать с объектом или модулем, поставь null и выбери reinspect.',
    JSON.stringify({ observationId, context, world: observation.world, telemetry: observation.telemetry, center, sensorStatistics: passes, nearbyObjects: nearby }),
  ].join('\n');
}

class OllamaVisionDispatcher {
  constructor(options = {}) {
    const configPath = options.configPath ?? path.join(root, 'agent-model-config.json');
    this.config = options.config ?? JSON.parse(fs.readFileSync(configPath, 'utf8'));
    this.dispatcher = this.config.visionDispatcher;
    const schemaPath = options.schemaPath ?? path.join(root, this.dispatcher.outputSchema);
    this.schema = options.schema ?? JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    this.timeoutMs = options.timeoutMs ?? 300000;
  }

  async status() {
    const response = await fetch(`${this.dispatcher.endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Ollama status failed: HTTP ${response.status}`);
    const body = await response.json();
    const available = (body.models ?? []).some(item => item.name === this.dispatcher.model || item.model === this.dispatcher.model);
    return { provider: 'ollama', endpoint: this.dispatcher.endpoint, model: this.dispatcher.model, available };
  }

  async analyze(observation, context = {}, referenceObservation = null) {
    const rgb = observation.visual?.passes?.rgb;
    if (!rgb?.dataUrl) throw new Error('RGB pass is required for visual inspection');
    const observationId = context.observationId ?? crypto.randomUUID();
    const objects = knownObjects(observation, context.center);
    const requestBody = {
      model: this.dispatcher.model,
      stream: false,
      think: false,
      format: this.schema,
      keep_alive: this.dispatcher.keepAlive,
      options: this.dispatcher.options,
      messages: [
        {
          role: 'system',
          content: 'Ты визуальный инспектор и диспетчер. Ты только наблюдаешь и формируешь структурированные находки для проверки Codex. Ты не меняешь код, файлы, Git или сборку.',
        },
        {
          role: 'user',
          content: buildPrompt(observationId, observation, context, context.center, Boolean(referenceObservation)),
          images: referenceObservation
            ? [stripDataUrl(referenceObservation.visual?.passes?.rgb?.dataUrl), stripDataUrl(rgb.dataUrl)]
            : [stripDataUrl(rgb.dataUrl)],
        },
      ],
    };
    const started = Date.now();
    const response = await fetch(`${this.dispatcher.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1000);
      throw new Error(`Ollama inference failed: HTTP ${response.status}: ${detail}`);
    }
    const body = await response.json();
    let finding;
    try { finding = JSON.parse(body.message?.content ?? ''); }
    catch { throw new Error('Ollama did not return valid JSON'); }
    const modelFinding = structuredClone(finding);
    const sensorGate = applySensorDeltaGate(finding, observation, context, this.config.dataPolicy);
    const validation = validateFinding(finding, observationId, objects, this.config.dataPolicy);
    return {
      ok: validation.errors.length === 0,
      model: this.dispatcher.model,
      role: this.dispatcher.role,
      codexReview: this.config.dataPolicy.codexReviewsEveryFinding ? 'required' : 'optional',
      modelFinding,
      finding,
      sensorGate,
      validation,
      metrics: modelMetrics(body, Date.now() - started),
    };
  }
}

module.exports = { OllamaVisionDispatcher, validateFinding, buildPrompt, applySensorDeltaGate };
