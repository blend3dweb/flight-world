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

function applyPerceptionGate(finding, perception, decision) {
  if (decision !== 'defect' || finding.decision !== 'pass') return { evaluated: Boolean(decision), applied: false, decision };
  finding.decision = 'reinspect';
  finding.summary = `Vision pass detected a defect that requires structured reinspection. ${finding.summary}`;
  finding.defects.push({
    category: 'unknown', severity: 'high', confidence: 0.8,
    description: 'The direct vision pass reported a visible regression, but the schema conversion returned pass.',
    pixel: null, objectId: null, semantic: null, module: null,
    evidence: [String(perception).slice(0, 500)],
    recommendedAction: 'Repeat inspection and localize the visual regression before changing code.',
  });
  return { evaluated: true, applied: true, decision };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function classifyPerception(perception, expected = []) {
  const text = String(perception ?? '');
  const severe = /severe rendering defect/is.test(text)
    && !/(?:not|isn't|is not|doesn't|does not|no)\s+(?:appear\s+to\s+be\s+)?(?:a\s+)?severe rendering defect/is.test(text);
  const missing = /no discernible objects?|required objects?.{0,80}(?:missing|not visible|absent)|(?:missing|lacks?) (?:the )?(?:required )?(?:city|buildings?|roads?|terrain|bridge|airport|vegetation|ocean)/is.test(text);
  const missingExpected = expected.some(value => {
    const category = value === 'city' ? 'cit(?:y|ies)' : `${escapeRegExp(value)}(?:s|es)?`;
    return new RegExp([
      `(?:no|without)\\s+(?:visible\\s+)?(?:[a-z]+\\s+){0,3}${category}\\b`,
      `(?:does|do|did)\\s+not\\s+(?:contain|show|include|depict)\\s+(?:any\\s+)?(?:[a-z]+\\s+){0,2}${category}\\b`,
      `\\b${category}\\b.{0,80}\\b(?:not visible|not present|missing|absent)\\b`,
    ].join('|'), 'is').test(text);
  });
  return severe || missing || missingExpected ? 'defect' : 'pass';
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
      ? 'Compare two Flight World RGB frames. Image 1 is the correct reference and image 2 is the current state. Find undesirable differences in image 2.'
      : 'Inspect the Flight World RGB frame together with the structured data.',
    'Return JSON only, matching the supplied schema. Do not use markdown.',
    'Act as a strict visual regression inspector. Inspect visible pixels; do not infer that an object is visible merely because telemetry or a catalog mentions it.',
    'context.expected lists categories that must be visibly present in the current RGB frame. A missing required category is a high or blocking geometry defect.',
    'A frame showing only sky or clouds is defective when context.expected includes city, building, road, terrain, bridge, airport, vegetation, or ocean.',
    'Do not invent objectId, semantic, or module. Use only values present in the observed object catalog.',
    'Only add an actual undesirable visual anomaly to defects. Expected rain, snow, fog, darkness, glare, reflections, sunset colors, and lower distant detail are not defects.',
    'If everything is visibly correct, choose pass and return defects: []. Do not create a defect merely to describe a correct effect.',
    'Choose reinspect when a possible anomaly is visible but the current evidence is insufficient. Describe the suspected anomaly.',
    'If a visible anomaly cannot be linked confidently to an object or module, use null and choose reinspect.',
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
    const images = referenceObservation
      ? [stripDataUrl(referenceObservation.visual?.passes?.rgb?.dataUrl), stripDataUrl(rgb.dataUrl)]
      : [stripDataUrl(rgb.dataUrl)];
    const inspectionPrompt = buildPrompt(observationId, observation, context, context.center, Boolean(referenceObservation));
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
          content: 'You are a visual regression inspector and dispatcher. You only observe and produce structured findings for Codex review. You never modify code, files, Git, or builds.',
        },
        {
          role: 'user',
          content: inspectionPrompt,
          images,
        },
      ],
    };
    const started = Date.now();
    let perception = null;
    let perceptionDecision = null;
    let perceptionMetrics = null;
    if (this.dispatcher.pipeline === 'perception-then-structure') {
      const perceptionStarted = Date.now();
      const expected = Array.isArray(context.expected) ? context.expected : [];
      const perceptionPrompt = [
        referenceObservation
          ? 'Compare image 1 (correct reference) with image 2 (current state). Evaluate image 2.'
          : 'Describe exactly what is visible in the current rendered image.',
        `The following objects are required: ${expected.length ? expected.join(', ') : 'none specified'}.`,
        'Are those required objects visibly present? Judge only the image pixels. If they are missing, state clearly that this is a severe rendering defect.',
      ].join('\n');
      const perceptionResponse = await fetch(`${this.dispatcher.endpoint}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.dispatcher.model,
          stream: false,
          think: false,
          keep_alive: this.dispatcher.keepAlive,
          options: this.dispatcher.options,
          messages: [{
            role: 'user',
            content: perceptionPrompt,
            images,
          }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!perceptionResponse.ok) {
        const detail = (await perceptionResponse.text()).slice(0, 1000);
        throw new Error(`Ollama perception failed: HTTP ${perceptionResponse.status}: ${detail}`);
      }
      const perceptionBody = await perceptionResponse.json();
      perception = String(perceptionBody.message?.content ?? '').trim().slice(0, 8000);
      if (!perception) throw new Error('Ollama perception pass returned no text');
      perceptionDecision = classifyPerception(perception, expected);
      perceptionMetrics = modelMetrics(perceptionBody, Date.now() - perceptionStarted);
    }
    let finding;
    let body = null;
    if (this.dispatcher.pipeline === 'perception-then-structure') {
      const defect = perceptionDecision === 'defect';
      finding = {
        observationId,
        decision: defect ? 'reinspect' : 'pass',
        summary: String(perception).slice(0, 1000),
        defects: defect ? [{
          category: 'geometry', severity: 'high', confidence: 0.9,
          description: 'The direct vision pass reported a visible regression or a missing required category.',
          pixel: null, objectId: null, semantic: null, module: null,
          evidence: [String(perception).slice(0, 500)],
          recommendedAction: 'Use object-ID and another viewpoint to localize the regression before changing code.',
        }] : [],
      };
    } else {
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
      body = await response.json();
      try { finding = JSON.parse(body.message?.content ?? ''); }
      catch { throw new Error('Ollama did not return valid JSON'); }
    }
    const modelFinding = structuredClone(finding);
    const perceptionGate = applyPerceptionGate(finding, perception, perceptionDecision);
    const sensorGate = applySensorDeltaGate(finding, observation, context, this.config.dataPolicy);
    const validation = validateFinding(finding, observationId, objects, this.config.dataPolicy);
    return {
      ok: validation.errors.length === 0,
      model: this.dispatcher.model,
      role: this.dispatcher.role,
      codexReview: this.config.dataPolicy.codexReviewsEveryFinding ? 'required' : 'optional',
      perception,
      perceptionDecision,
      perceptionGate,
      perceptionMetrics,
      modelFinding,
      finding,
      sensorGate,
      validation,
      metrics: body
        ? modelMetrics(body, Date.now() - started)
        : { ...perceptionMetrics, wallMs: Date.now() - started, pipeline: 'perception-then-deterministic-structure' },
    };
  }
}

module.exports = { OllamaVisionDispatcher, validateFinding, buildPrompt, applySensorDeltaGate, classifyPerception };
