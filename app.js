const state = {
  purpose: "memories",
  photos: [],
  pickPercent: 25,
  view: "picks",
  expressionFilter: "all",
  faceModelReady: false,
  faceModelError: "",
};

const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const MAX_FOLDER_IMAGES = IS_IOS ? 100 : 500;
const PREVIEW_MAX_EDGE = 720;
const FACE_ANALYSIS_MAX_EDGE = 512;
const MAX_ZIP_BYTES = 500 * 1024 * 1024;
let faceLandmarker = null;
let faceLandmarkerPromise = null;
let deferredInstallPrompt = null;

const purposeConfig = {
  memories: {
    label: "personal memories",
    message: "Natural expressions and open eyes lead; imperfect lighting can be edited later.",
  },
  candid: {
    label: "candid moments",
    message: "Authentic laughter, interaction, and intentional off-camera gaze are protected from false rejection.",
  },
  social: {
    label: "social media",
    message: "Expressive faces lead, followed by useful framing, color, and technical quality.",
  },
  portfolio: {
    label: "a portfolio",
    message: "Facial timing leads within bursts, then face detail and overall technical quality.",
  },
  profile: {
    label: "a profile photo",
    message: "Open eyes, natural expression, face sharpness, and camera gaze receive the strongest weight.",
  },
  best: {
    label: "best overall quality",
    message: "For photos with people, expression leads. Photos without faces use technical quality.",
  },
};

const els = {
  setupView: document.querySelector("#setupView"),
  resultsView: document.querySelector("#resultsView"),
  fileInput: document.querySelector("#fileInput"),
  folderInput: document.querySelector("#folderInput"),
  dropZone: document.querySelector("#dropZone"),
  purposeGrid: document.querySelector("#purposeGrid"),
  purposeSelect: document.querySelector("#purposeSelect"),
  analysisOverlay: document.querySelector("#analysisOverlay"),
  analysisTitle: document.querySelector("#analysisTitle"),
  analysisProgress: document.querySelector("#analysisProgress"),
  progressBar: document.querySelector("#progressBar"),
  processedCount: document.querySelector("#processedCount"),
  processingTotal: document.querySelector("#processingTotal"),
  photoGrid: document.querySelector("#photoGrid"),
  template: document.querySelector("#photoTemplate"),
  pickPercent: document.querySelector("#pickPercent"),
  pickPercentLabel: document.querySelector("#pickPercentLabel"),
  viewTabs: document.querySelector("#viewTabs"),
  expressionFilters: document.querySelector("#expressionFilters"),
  detailModal: document.querySelector("#detailModal"),
  detailContent: document.querySelector("#detailContent"),
  toast: document.querySelector("#toast"),
  modelNote: document.querySelector("#modelNote"),
  faceAiStatus: document.querySelector("#faceAiStatus"),
  installAppButton: document.querySelector("#installAppButton"),
  ipadInstall: document.querySelector("#ipadInstall"),
  batchLimitText: document.querySelector("#batchLimitText"),
};

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value, low, high) {
  return clamp(((value - low) / (high - low)) * 100);
}

function weightedAverage(items, valueKey, weightKey = "area") {
  const totalWeight = items.reduce((sum, item) => sum + Math.max(item[weightKey] || 0, 0.0001), 0);
  if (!totalWeight) return 0;
  return items.reduce((sum, item) => sum + item[valueKey] * Math.max(item[weightKey] || 0, 0.0001), 0) / totalWeight;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function initializeFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;
  if (faceLandmarkerPromise) return faceLandmarkerPromise;

  faceLandmarkerPromise = (async () => {
    const { FilesetResolver, FaceLandmarker } = await import("./vendor/mediapipe/vision_bundle.mjs");
    const vision = await FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
    const detector = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "./models/face_landmarker.task",
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      numFaces: 10,
      minFaceDetectionConfidence: 0.45,
      minFacePresenceConfidence: 0.45,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    faceLandmarker = detector;
    state.faceModelReady = true;
    state.faceModelError = "";
    updateFaceModelStatus();
    return detector;
  })().catch((error) => {
    state.faceModelReady = false;
    state.faceModelError =
      location.protocol === "file:"
        ? "Open the app from http://127.0.0.1:8000 for expression analysis."
        : "Face model could not load; technical ranking remains available.";
    updateFaceModelStatus();
    faceLandmarkerPromise = null;
    throw error;
  });

  return faceLandmarkerPromise;
}

function updateFaceModelStatus() {
  if (els.modelNote) {
    els.modelNote.classList.toggle("model-error", Boolean(state.faceModelError));
    const text = els.modelNote.querySelector("small");
    if (text) {
      text.textContent = state.faceModelReady
        ? "Detects faces, blinks, gaze, smiles, candid moments, and group-photo issues."
        : state.faceModelError || "Preparing the local face model.";
    }
  }
  if (els.faceAiStatus) {
    els.faceAiStatus.textContent = state.faceModelReady
      ? "Face model active"
      : state.faceModelError || "Face model loading";
    els.faceAiStatus.classList.toggle("error", Boolean(state.faceModelError));
  }
}

function calculateLaplacianVariance(gray, width, height) {
  let sum = 0;
  let squared = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const value =
        gray[index - 1] +
        gray[index + 1] +
        gray[index - width] +
        gray[index + width] -
        4 * gray[index];
      sum += value;
      squared += value * value;
      count++;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, squared / count - mean * mean);
}

function analyzeImage(image) {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  const gray = new Float32Array(size * size);
  let brightnessSum = 0;
  let brightnessSquared = 0;
  let saturationSum = 0;
  let clippedDark = 0;
  let clippedLight = 0;
  let red = 0;
  let green = 0;
  let blue = 0;

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    gray[p] = luminance;
    brightnessSum += luminance;
    brightnessSquared += luminance * luminance;
    saturationSum += Math.max(r, g, b) - Math.min(r, g, b);
    if (luminance < 18) clippedDark++;
    if (luminance > 238) clippedLight++;
    red += r;
    green += g;
    blue += b;
  }

  const count = size * size;
  const brightness = brightnessSum / count;
  const contrast = Math.sqrt(Math.max(0, brightnessSquared / count - brightness * brightness));
  let differenceHash = "";
  for (let row = 0; row < 8; row++) {
    const y = Math.min(size - 1, row * 8 + 4);
    for (let column = 0; column < 8; column++) {
      const leftX = Math.min(size - 2, column * 8 + 3);
      differenceHash += gray[y * size + leftX] > gray[y * size + leftX + 1] ? "1" : "0";
    }
  }

  return {
    brightness,
    contrast,
    saturation: saturationSum / count,
    clipping: ((clippedDark + clippedLight) / count) * 100,
    sharpnessRaw: calculateLaplacianVariance(gray, size, size),
    hash: differenceHash,
    signature: [
      Math.round(red / count / 14),
      Math.round(green / count / 14),
      Math.round(blue / count / 14),
      Math.round(brightness / 12),
      Math.round(contrast / 8),
    ].join("-"),
  };
}

function createPreviewBlob(image) {
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Preview creation failed"))),
      "image/jpeg",
      0.78
    );
  });
}

function createFaceAnalysisCanvas(image) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.min(1, FACE_ANALYSIS_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function blendshapeMap(result, faceIndex) {
  const map = {};
  const categories = result.faceBlendshapes?.[faceIndex]?.categories || [];
  categories.forEach((category) => {
    map[category.categoryName] = category.score;
  });
  return map;
}

function blend(map, name) {
  return map[name] || 0;
}

function average(...values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function faceBounds(landmarks) {
  const xs = landmarks.map((point) => point.x);
  const ys = landmarks.map((point) => point.y);
  const minX = Math.max(0, Math.min(...xs));
  const maxX = Math.min(1, Math.max(...xs));
  const minY = Math.max(0, Math.min(...ys));
  const maxY = Math.min(1, Math.max(...ys));
  return {
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    area: Math.max(0, (maxX - minX) * (maxY - minY)),
  };
}

function calculateFaceSharpness(image, bounds) {
  const imageWidth = image.naturalWidth || image.width;
  const imageHeight = image.naturalHeight || image.height;
  const paddingX = bounds.width * 0.12;
  const paddingY = bounds.height * 0.12;
  const sx = Math.max(0, (bounds.minX - paddingX) * imageWidth);
  const sy = Math.max(0, (bounds.minY - paddingY) * imageHeight);
  const ex = Math.min(imageWidth, (bounds.maxX + paddingX) * imageWidth);
  const ey = Math.min(imageHeight, (bounds.maxY + paddingY) * imageHeight);
  const sourceWidth = Math.max(1, ex - sx);
  const sourceHeight = Math.max(1, ey - sy);
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, sx, sy, sourceWidth, sourceHeight, 0, 0, size, size);
  const data = context.getImageData(0, 0, size, size).data;
  const gray = new Float32Array(size * size);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  const raw = calculateLaplacianVariance(gray, size, size);
  return normalize(Math.log10(raw + 1), 1.1, 3.35);
}

function gazeFromLandmarks(landmarks, shapes) {
  const leftEyeX = average(landmarks[33]?.x || 0, landmarks[133]?.x || 0);
  const rightEyeX = average(landmarks[362]?.x || 0, landmarks[263]?.x || 0);
  const noseX = landmarks[1]?.x || average(leftEyeX, rightEyeX);
  const leftDistance = Math.abs(noseX - leftEyeX);
  const rightDistance = Math.abs(rightEyeX - noseX);
  const headTurn = Math.abs(leftDistance - rightDistance) / Math.max(leftDistance + rightDistance, 0.001);
  const eyeLook = Math.max(
    average(blend(shapes, "eyeLookInLeft"), blend(shapes, "eyeLookInRight")),
    average(blend(shapes, "eyeLookOutLeft"), blend(shapes, "eyeLookOutRight")),
    average(blend(shapes, "eyeLookUpLeft"), blend(shapes, "eyeLookUpRight")),
    average(blend(shapes, "eyeLookDownLeft"), blend(shapes, "eyeLookDownRight"))
  );
  return {
    score: clamp(100 - headTurn * 135 - eyeLook * 90),
    headTurn,
    eyeLook,
  };
}

function analyzeDetectedFace(image, result, faceIndex) {
  const landmarks = result.faceLandmarks[faceIndex];
  const shapes = blendshapeMap(result, faceIndex);
  const bounds = faceBounds(landmarks);
  const blinkLeft = blend(shapes, "eyeBlinkLeft");
  const blinkRight = blend(shapes, "eyeBlinkRight");
  const blinkAverage = average(blinkLeft, blinkRight);
  const blinkMaximum = Math.max(blinkLeft, blinkRight);
  const blinkAsymmetry = Math.abs(blinkLeft - blinkRight);
  const closedEyes = blinkAverage > 0.62 || blinkMaximum > 0.76;
  const halfBlink =
    !closedEyes &&
    (blinkAverage > 0.28 || blinkMaximum > 0.52 || (blinkAsymmetry > 0.34 && blinkMaximum > 0.4));
  const eyeOpenScore = clamp(100 - blinkAverage * 105 - blinkAsymmetry * 28);

  const smile = average(blend(shapes, "mouthSmileLeft"), blend(shapes, "mouthSmileRight"));
  const cheekSquint = average(blend(shapes, "cheekSquintLeft"), blend(shapes, "cheekSquintRight"));
  const jawOpen = blend(shapes, "jawOpen");
  const mouthFunnel = blend(shapes, "mouthFunnel");
  const mouthPucker = blend(shapes, "mouthPucker");
  const mouthAsymmetry =
    Math.abs(blend(shapes, "mouthSmileLeft") - blend(shapes, "mouthSmileRight")) +
    Math.abs(blend(shapes, "mouthFrownLeft") - blend(shapes, "mouthFrownRight")) +
    Math.max(blend(shapes, "mouthLeft"), blend(shapes, "mouthRight"));
  const browAsymmetry =
    Math.abs(blend(shapes, "browOuterUpLeft") - blend(shapes, "browOuterUpRight")) +
    Math.abs(blend(shapes, "browDownLeft") - blend(shapes, "browDownRight"));
  const laughter = jawOpen > 0.28 && (smile > 0.24 || cheekSquint > 0.18);
  const awkwardMouth =
    (jawOpen > 0.38 && smile < 0.18 && cheekSquint < 0.16) ||
    mouthAsymmetry > 0.68 ||
    ((mouthFunnel > 0.58 || mouthPucker > 0.64) && smile < 0.15);
  let mouthScore = 88;
  if (laughter) mouthScore = 94;
  else if (awkwardMouth) mouthScore = 28;
  else if (jawOpen > 0.28) mouthScore = clamp(82 - (jawOpen - 0.28) * 90);
  else mouthScore = clamp(84 + smile * 18 - mouthAsymmetry * 24);

  const gaze = gazeFromLandmarks(landmarks, shapes);
  const lookingTowardCamera = gaze.score >= 63;
  const naturalOffCamera =
    !lookingTowardCamera &&
    !closedEyes &&
    !halfBlink &&
    !awkwardMouth;
  const candidSignal = naturalOffCamera && (laughter || smile > 0.16 || cheekSquint > 0.12);
  const naturalScore = clamp(
    78 + smile * 18 + cheekSquint * 12 + (laughter ? 8 : 0) - mouthAsymmetry * 28 - browAsymmetry * 12
  );

  return {
    area: bounds.area,
    bounds,
    expressionScore: 0,
    faceSharpness: calculateFaceSharpness(image, bounds),
    eyeOpenScore,
    gazeScore: gaze.score,
    smileScore: clamp(smile * 125),
    smile,
    jawOpen,
    closedEyes,
    halfBlink,
    awkwardMouth,
    lookingTowardCamera,
    naturalOffCamera,
    candidSignal,
    candid: false,
    laughter,
    mouthScore,
    naturalScore,
  };
}

function scoreFaceExpression(face) {
  const candid = face.naturalOffCamera && (state.purpose === "candid" || face.candidSignal);
  const gazeWeight = candid ? 0.04 : state.purpose === "profile" ? 0.18 : 0.1;
  let expressionScore = clamp(
    face.eyeOpenScore * 0.43 +
      face.mouthScore * 0.25 +
      face.naturalScore * (0.32 - gazeWeight) +
      face.gazeScore * gazeWeight
  );
  if (face.closedEyes) expressionScore = Math.min(expressionScore, 24);
  else if (face.halfBlink) expressionScore = Math.min(expressionScore, 46);
  return { ...face, candid, expressionScore };
}

function summarizeFaces(faces) {
  if (!faces.length) {
    return {
      faceCount: 0,
      faces: [],
      expressionScore: null,
      faceSharpness: null,
      eyeOpenScore: null,
      gazeScore: null,
      closedEyes: false,
      blinkDetected: false,
      awkwardExpression: false,
      groupIssue: false,
      candid: false,
      lookingTowardCamera: false,
    };
  }

  const rescoredFaces = faces.map(scoreFaceExpression);
  const sorted = [...rescoredFaces].sort((a, b) => b.area - a.area);
  const largestArea = sorted[0].area;
  const importantFaces = sorted.filter((face, index) => index === 0 || face.area >= largestArea * 0.34).slice(0, 8);
  const minimumExpression = Math.min(...importantFaces.map((face) => face.expressionScore));
  const weightedExpression = weightedAverage(importantFaces, "expressionScore");
  const expressionScore = clamp(weightedExpression * 0.7 + minimumExpression * 0.3);
  const closedEyes = importantFaces.some((face) => face.closedEyes);
  const blinkDetected = importantFaces.some((face) => face.halfBlink);
  const awkwardExpression = importantFaces.some((face) => face.awkwardMouth);
  const groupIssue =
    importantFaces.length > 1 &&
    importantFaces.some((face) => face.closedEyes || face.halfBlink || face.awkwardMouth);

  return {
    faceCount: faces.length,
    importantFaceCount: importantFaces.length,
    faces: rescoredFaces,
    expressionScore,
    faceSharpness: weightedAverage(importantFaces, "faceSharpness"),
    eyeOpenScore: weightedAverage(importantFaces, "eyeOpenScore"),
    gazeScore: weightedAverage(importantFaces, "gazeScore"),
    smileScore: weightedAverage(importantFaces, "smileScore"),
    closedEyes,
    blinkDetected,
    awkwardExpression,
    groupIssue,
    candid: importantFaces.some((face) => face.candid) && !groupIssue,
    naturalOffCamera: importantFaces.some((face) => face.naturalOffCamera) && !groupIssue,
    lookingTowardCamera: importantFaces.filter((face) => face.lookingTowardCamera).length >= Math.ceil(importantFaces.length / 2),
  };
}

async function analyzeFaces(image) {
  if (!faceLandmarker) return summarizeFaces([]);
  const analysisCanvas = createFaceAnalysisCanvas(image);
  try {
    const result = faceLandmarker.detect(analysisCanvas);
    const faces = (result.faceLandmarks || []).map((_, index) =>
      analyzeDetectedFace(analysisCanvas, result, index)
    );
    return summarizeFaces(faces);
  } catch {
    return { ...summarizeFaces([]), analysisFailed: true };
  } finally {
    analysisCanvas.width = 1;
    analysisCanvas.height = 1;
  }
}

function buildMetrics(raw, width, height) {
  const megapixels = (width * height) / 1_000_000;
  const sharpness = normalize(Math.log10(raw.sharpnessRaw + 1), 1.25, 3.2);
  const exposureDistance = Math.abs(raw.brightness - 132);
  const exposure = clamp(100 - exposureDistance * 1.05 - raw.clipping * 1.5);
  const contrast = clamp(100 - Math.abs(raw.contrast - 52) * 1.45);
  const resolution = normalize(megapixels, 0.4, 12);
  const color = clamp(48 + raw.saturation * 1.15 - Math.max(0, raw.saturation - 75) * 1.4);
  const ratio = width / height;
  let framing = 75;
  if (state.purpose === "profile") framing = ratio < 1 ? 100 : ratio < 1.25 ? 76 : 48;
  if (state.purpose === "social") framing = ratio >= 0.75 && ratio <= 1.35 ? 100 : 68;
  return { sharpness, exposure, contrast, resolution, color, framing };
}

function technicalScore(photo) {
  const metrics = photo.metrics;
  return (
    metrics.sharpness * 0.31 +
    metrics.exposure * 0.23 +
    metrics.contrast * 0.15 +
    metrics.resolution * 0.13 +
    metrics.color * 0.11 +
    metrics.framing * 0.07
  );
}

function scorePhoto(photo) {
  photo.metrics = buildMetrics(photo.raw, photo.width, photo.height);
  const technical = technicalScore(photo);
  if (!photo.face?.faceCount) {
    photo.baseScore = clamp(technical);
    photo.score = photo.baseScore;
    photo.flags = {
      bestExpression: false,
      closedEyes: false,
      blinkDetected: false,
      needsEditing: false,
      badExpression: false,
      groupIssue: false,
    };
    return;
  }

  photo.face = summarizeFaces(photo.face.faces);
  const face = photo.face;
  let score =
    face.expressionScore * 0.58 +
    face.faceSharpness * 0.18 +
    photo.metrics.sharpness * 0.11 +
    photo.metrics.exposure * 0.06 +
    photo.metrics.contrast * 0.03 +
    photo.metrics.resolution * 0.02 +
    photo.metrics.framing * 0.02;

  if (face.closedEyes) score -= 34;
  else if (face.blinkDetected) score -= 22;
  if (face.awkwardExpression) score -= 24;
  if (face.groupIssue) score -= 18;
  if (state.purpose === "profile" && !face.lookingTowardCamera) score -= 12;

  const needsEditing =
    face.expressionScore >= 72 &&
    !face.closedEyes &&
    !face.blinkDetected &&
    !face.awkwardExpression &&
    photo.metrics.exposure < 58;
  if (needsEditing) {
    score = Math.max(score, face.expressionScore * 0.72 + face.faceSharpness * 0.18);
  }

  const badExpression =
    face.closedEyes ||
    face.blinkDetected ||
    face.awkwardExpression ||
    face.expressionScore < 48 ||
    face.groupIssue;
  if (face.closedEyes) score = Math.min(score, 28);
  else if (face.blinkDetected || face.groupIssue || face.awkwardExpression) score = Math.min(score, 48);

  photo.flags = {
    bestExpression: face.expressionScore >= 80 && !badExpression,
    closedEyes: face.closedEyes,
    blinkDetected: face.blinkDetected,
    needsEditing,
    badExpression,
    groupIssue: face.groupIssue,
  };
  photo.baseScore = clamp(score);
  photo.score = photo.baseScore;
}

function hammingDistance(first, second) {
  if (!first || !second || first.length !== second.length) return Infinity;
  let distance = 0;
  for (let index = 0; index < first.length; index++) {
    if (first[index] !== second[index]) distance++;
  }
  return distance;
}

function burstStem(photo) {
  const relativePath = photo.file.webkitRelativePath || photo.name;
  const directory = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
  const stem = photo.name
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[\s_-]?\d{2,}$/, "");
  return `${directory.toLowerCase()}|${stem}`;
}

function areSimilar(first, second) {
  const ratioDifference = Math.abs(first.width / first.height - second.width / second.height);
  if (ratioDifference > 0.045) return false;
  const exactDuplicate =
    first.fileSize === second.fileSize && first.width === second.width && first.height === second.height;
  if (exactDuplicate) return true;
  const hashDistance = hammingDistance(first.raw.hash, second.raw.hash);
  if (hashDistance <= 10) return true;
  const likelyBurst =
    burstStem(first) === burstStem(second) &&
    Math.abs((first.file.lastModified || 0) - (second.file.lastModified || 0)) < 120000;
  return likelyBurst && hashDistance <= 20;
}

function compareBurstCandidates(first, second) {
  const firstHasFaces = Boolean(first.face?.faceCount);
  const secondHasFaces = Boolean(second.face?.faceCount);
  if (firstHasFaces !== secondHasFaces) return firstHasFaces ? -1 : 1;
  if (firstHasFaces && secondHasFaces) {
    if (first.flags.closedEyes !== second.flags.closedEyes) return first.flags.closedEyes ? 1 : -1;
    if (first.flags.blinkDetected !== second.flags.blinkDetected) return first.flags.blinkDetected ? 1 : -1;
    if (first.flags.groupIssue !== second.flags.groupIssue) return first.flags.groupIssue ? 1 : -1;
    if (Math.abs(first.face.expressionScore - second.face.expressionScore) > 2) {
      return second.face.expressionScore - first.face.expressionScore;
    }
    if (Math.abs(first.face.faceSharpness - second.face.faceSharpness) > 2) {
      return second.face.faceSharpness - first.face.faceSharpness;
    }
  }
  if (Math.abs(first.metrics.sharpness - second.metrics.sharpness) > 2) {
    return second.metrics.sharpness - first.metrics.sharpness;
  }
  if (Math.abs(first.metrics.exposure - second.metrics.exposure) > 2) {
    return second.metrics.exposure - first.metrics.exposure;
  }
  return second.baseScore - first.baseScore;
}

function detectSimilarPhotos() {
  state.photos.forEach((photo) => {
    photo.similarTo = null;
    photo.burstAlternatives = 0;
    photo.burstAdvantage = "";
    photo.score = photo.baseScore;
  });

  const assigned = new Set();
  state.photos.forEach((photo, index) => {
    if (assigned.has(photo.id)) return;
    const group = [photo];
    for (let candidateIndex = index + 1; candidateIndex < state.photos.length; candidateIndex++) {
      const candidate = state.photos[candidateIndex];
      if (!assigned.has(candidate.id) && areSimilar(photo, candidate)) group.push(candidate);
    }
    if (group.length < 2) return;

    group.sort(compareBurstCandidates);
    const winner = group[0];
    winner.burstAlternatives = group.length - 1;
    const runnerUp = group[1];
    if (
      winner.face?.faceCount &&
      runnerUp.face?.faceCount &&
      winner.face.expressionScore > runnerUp.face.expressionScore + 2
    ) {
      winner.burstAdvantage = "Best pick: natural expression and open eyes";
    } else if (
      winner.face?.faceCount &&
      runnerUp.face?.faceCount &&
      winner.face.faceSharpness > runnerUp.face.faceSharpness + 2
    ) {
      winner.burstAdvantage = "Better face sharpness than other burst shots";
    } else {
      winner.burstAdvantage = "Strongest timing in this burst";
    }

    group.slice(1).forEach((candidate) => {
      candidate.similarTo = winner.id;
      candidate.score = clamp(candidate.score - 18);
      assigned.add(candidate.id);
    });
    assigned.add(winner.id);
  });
}

function rankPhotos() {
  state.photos.forEach(scorePhoto);
  detectSimilarPhotos();
  const ranked = [...state.photos].sort((first, second) => second.score - first.score);
  const automaticPickCount = Math.max(1, Math.ceil(ranked.length * state.pickPercent / 100));
  let picked = 0;
  ranked.forEach((photo, index) => {
    photo.rank = index + 1;
    const eligible = !photo.similarTo && !photo.flags.badExpression;
    photo.autoPick = eligible && picked < automaticPickCount;
    if (photo.autoPick) picked++;
  });
}

function reasonFor(photo) {
  if (photo.manualPick === true) return "Manually added to your picks";
  if (photo.manualPick === false) return "Manually removed from your picks";
  if (photo.flags?.groupIssue && photo.flags?.closedEyes) {
    return "Group photo issue: one or more faces have closed eyes";
  }
  if (photo.flags?.groupIssue) return "Group photo issue: one or more faces have poor expression timing";
  if (photo.flags?.closedEyes) return "Reject candidate: closed eyes";
  if (photo.flags?.blinkDetected) return "Reject candidate: blink detected";
  if (photo.face?.awkwardExpression) return "Reject candidate: awkward expression or mid-speech timing";
  if (photo.flags?.needsEditing) return "Good expression, lighting can be edited";
  if (photo.similarTo) return "Similar burst shot: a stronger facial moment was found";
  if (photo.burstAdvantage) return photo.burstAdvantage;
  if (photo.face?.candid && photo.face.expressionScore >= 70) {
    return "Best pick: natural candid expression";
  }
  if (photo.flags?.bestExpression) return "Best pick: natural expression and open eyes";
  if (photo.face?.faceCount && photo.autoPick) return "Open eyes and strong facial timing";
  if (!photo.face?.faceCount && photo.autoPick) return "Strong technical quality; no face detected";
  if (photo.flags?.badExpression) return "Reject candidate: weak facial timing";
  return "Usable photo, but stronger options ranked higher";
}

function statusFor(photo) {
  if (photo.flags?.groupIssue) return { text: "Group issue", className: "reject" };
  if (photo.flags?.closedEyes) return { text: "Closed eyes", className: "reject" };
  if (photo.flags?.blinkDetected) return { text: "Blink", className: "reject" };
  if (photo.flags?.badExpression) return { text: "Reject candidate", className: "reject" };
  if (photo.flags?.needsEditing) return { text: "Needs editing", className: "maybe" };
  if (photo.face?.candid) return { text: "Natural candid", className: "candid" };
  if (isPicked(photo)) return { text: "Best pick", className: "" };
  return { text: "Maybe", className: "maybe" };
}

function isPicked(photo) {
  return photo.manualPick ?? photo.autoPick;
}

async function processFiles(fileList) {
  const supported = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
  const imageFiles = [...fileList].filter(
    (file) => file.type.startsWith("image/") || supported.test(file.name)
  );
  const files = imageFiles.slice(0, MAX_FOLDER_IMAGES);
  const safetySkipped = Math.max(0, imageFiles.length - files.length);
  if (!files.length) {
    showToast("No image files were selected.");
    return;
  }

  els.analysisOverlay.classList.remove("hidden");
  els.analysisTitle.textContent = "Loading the local face model...";
  els.analysisProgress.textContent = "No photos are uploaded. Analysis stays in this browser.";
  els.processingTotal.textContent = files.length;
  els.processedCount.textContent = "0";
  els.progressBar.style.width = "0%";

  let faceAnalysisAvailable = true;
  try {
    await initializeFaceLandmarker();
  } catch {
    faceAnalysisAvailable = false;
  }

  els.analysisTitle.textContent = faceAnalysisAvailable
    ? "Checking eyes, faces, and timing..."
    : "Checking technical image quality...";
  els.analysisProgress.textContent = faceAnalysisAvailable
    ? "Expression first, then face sharpness, overall sharpness, and lighting."
    : state.faceModelError;

  let failed = 0;
  let faceAnalysisFailures = 0;
  let imported = 0;
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const sourceUrl = URL.createObjectURL(file);
    let image;
    try {
      image = await loadImage(sourceUrl);
      const raw = analyzeImage(image);
      const face = faceAnalysisAvailable ? await analyzeFaces(image) : summarizeFaces([]);
      if (face.analysisFailed) faceAnalysisFailures++;
      const previewBlob = await createPreviewBlob(image);
      const previewUrl = URL.createObjectURL(previewBlob);
      state.photos.push({
        id: crypto.randomUUID(),
        file,
        url: previewUrl,
        name: file.name,
        displayName: file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " "),
        fileSize: file.size,
        width: image.naturalWidth,
        height: image.naturalHeight,
        raw,
        face,
        manualPick: null,
      });
      imported++;
    } catch {
      failed++;
    } finally {
      if (image) image.src = "";
      URL.revokeObjectURL(sourceUrl);
    }

    els.processedCount.textContent = index + 1;
    els.progressBar.style.width = `${((index + 1) / files.length) * 100}%`;
    await new Promise((resolve) => setTimeout(resolve, index % 5 === 0 ? 75 : 18));
  }

  if (!imported) {
    els.analysisOverlay.classList.add("hidden");
    showToast("Those files could not be opened. Try JPEG, PNG, or WebP images.");
    return;
  }

  rankPhotos();
  await new Promise((resolve) => setTimeout(resolve, 250));
  els.analysisOverlay.classList.add("hidden");
  els.setupView.classList.add("hidden");
  els.resultsView.classList.remove("hidden");
  state.view = "picks";
  state.expressionFilter = "all";
  setActiveTabs();
  updateResults();

  const notices = [];
  if (failed) notices.push(`${failed} could not be opened`);
  if (safetySkipped) notices.push(`${safetySkipped} skipped for browser safety`);
  if (!faceAnalysisAvailable) notices.push("expression model unavailable");
  if (faceAnalysisFailures) notices.push(`${faceAnalysisFailures} used technical scoring only`);
  showToast(`${imported} photos analyzed${notices.length ? `; ${notices.join(", ")}` : ""}.`);
}

function matchesExpressionFilter(photo) {
  switch (state.expressionFilter) {
    case "best":
      return photo.flags?.bestExpression;
    case "closed":
      return photo.flags?.closedEyes;
    case "blink":
      return photo.flags?.blinkDetected;
    case "needs-editing":
      return photo.flags?.needsEditing;
    case "bad":
      return photo.flags?.badExpression;
    case "group":
      return photo.flags?.groupIssue;
    default:
      return true;
  }
}

function filteredPhotos() {
  let ranked = [...state.photos].sort((first, second) => first.rank - second.rank);
  if (state.view === "picks") ranked = ranked.filter(isPicked);
  if (state.view === "rejected") ranked = ranked.filter((photo) => !isPicked(photo));
  return ranked.filter(matchesExpressionFilter);
}

function renderPhotos() {
  const photos = filteredPhotos();
  els.photoGrid.innerHTML = "";
  photos.forEach((photo) => {
    const fragment = els.template.content.cloneNode(true);
    const card = fragment.querySelector(".photo-card");
    const image = fragment.querySelector("img");
    const picked = isPicked(photo);
    image.src = photo.url;
    image.alt = photo.displayName;
    fragment.querySelector(".rank-badge").textContent = `#${photo.rank}`;
    const status = fragment.querySelector(".status-badge");
    const statusData = statusFor(photo);
    status.textContent = statusData.text;
    status.classList.toggle("maybe", statusData.className === "maybe");
    status.classList.toggle("reject", statusData.className === "reject");
    status.classList.toggle("candid", statusData.className === "candid");
    const faceBadge = fragment.querySelector(".face-score-badge");
    if (photo.face?.faceCount) {
      faceBadge.textContent = `Face ${Math.round(photo.face.expressionScore)}`;
      faceBadge.title = `${photo.face.faceCount} face${photo.face.faceCount === 1 ? "" : "s"} detected`;
    } else {
      faceBadge.textContent = "No face";
      faceBadge.classList.add("no-face");
    }
    fragment.querySelector(".photo-name").textContent = photo.displayName;
    fragment.querySelector(".photo-reason").textContent = reasonFor(photo);
    fragment.querySelector(".quality-score").textContent = `${Math.round(photo.score)}`;
    fragment.querySelector(".score-bar i").style.width = `${photo.score}%`;
    const keepButton = fragment.querySelector(".keep-button");
    keepButton.innerHTML = picked ? "&#9829;" : "&#9825;";
    keepButton.classList.toggle("active", picked);
    keepButton.addEventListener("click", (event) => {
      event.stopPropagation();
      photo.manualPick = !picked;
      updateResults();
    });
    fragment.querySelector(".image-overlay button").addEventListener("click", () => showDetails(photo));
    card.addEventListener("dblclick", () => showDetails(photo));
    els.photoGrid.appendChild(fragment);
  });
  document.querySelector("#emptyFilter").classList.toggle("hidden", photos.length > 0);
}

function updateFilterAvailability() {
  const counts = {
    all: state.photos.length,
    best: state.photos.filter((photo) => photo.flags?.bestExpression).length,
    closed: state.photos.filter((photo) => photo.flags?.closedEyes).length,
    blink: state.photos.filter((photo) => photo.flags?.blinkDetected).length,
    "needs-editing": state.photos.filter((photo) => photo.flags?.needsEditing).length,
    bad: state.photos.filter((photo) => photo.flags?.badExpression).length,
    group: state.photos.filter((photo) => photo.flags?.groupIssue).length,
  };
  els.expressionFilters.querySelectorAll("button").forEach((button) => {
    const baseLabel = button.dataset.label || button.textContent.replace(/\s+\(\d+\)$/, "");
    button.dataset.label = baseLabel;
    button.textContent = `${baseLabel} (${counts[button.dataset.filter] || 0})`;
  });
}

function updateResults() {
  const picks = state.photos.filter(isPicked);
  const rejects = state.photos.length - picks.length;
  const config = purposeConfig[state.purpose];
  document.querySelector("#totalCount").textContent = state.photos.length;
  document.querySelector("#pickCount").textContent = picks.length;
  document.querySelector("#rejectCount").textContent = rejects;
  document.querySelector("#headingPickCount").textContent = `${picks.length} photo${picks.length === 1 ? "" : "s"}`;
  document.querySelector("#resultsSummary").textContent =
    `Ranked for ${config.label}. Facial expression leads whenever people are detected.`;
  document.querySelector("#recommendationText").textContent = config.message;
  document.querySelector("#picksTabCount").textContent = picks.length;
  document.querySelector("#allTabCount").textContent = state.photos.length;
  document.querySelector("#rejectedTabCount").textContent = rejects;
  els.pickPercentLabel.textContent = `${state.pickPercent}%`;
  updateFilterAvailability();
  renderPhotos();
}

function showDetails(photo) {
  const picked = isPicked(photo);
  const metrics = {
    ...(photo.face?.faceCount
      ? {
          expression: photo.face.expressionScore,
          faceSharpness: photo.face.faceSharpness,
          eyesOpen: photo.face.eyeOpenScore,
          cameraGaze: photo.face.gazeScore,
        }
      : {}),
    overallSharpness: photo.metrics.sharpness,
    exposure: photo.metrics.exposure,
    contrast: photo.metrics.contrast,
    resolution: photo.metrics.resolution,
  };
  const metricNames = {
    expression: "Face expression",
    faceSharpness: "Face sharpness",
    eyesOpen: "Eyes open",
    cameraGaze: photo.face?.candid ? "Candid gaze" : "Camera gaze",
    overallSharpness: "Overall sharpness",
    exposure: "Exposure",
    contrast: "Contrast",
    resolution: "Resolution",
  };
  const metricMarkup = Object.entries(metrics)
    .map(
      ([name, value]) => `
        <div class="metric">
          <span>${metricNames[name]}</span>
          <div class="metric-track"><i style="width:${value}%"></i></div>
          <strong>${Math.round(value)}</strong>
        </div>
      `
    )
    .join("");
  const faceSummary = photo.face?.faceCount
    ? `${photo.face.faceCount} face${photo.face.faceCount === 1 ? "" : "s"} detected`
    : state.faceModelReady
      ? "No face detected"
      : "Face analysis unavailable";

  els.detailContent.innerHTML = `
    <div class="detail-grid">
      <img src="${photo.url}" alt="${escapeHTML(photo.displayName)}" />
      <div class="detail-copy">
        <span class="eyebrow">Rank #${photo.rank} &middot; Score ${Math.round(photo.score)}</span>
        <h2>${escapeHTML(photo.displayName)}</h2>
        <p>${photo.width} &times; ${photo.height} &middot; ${formatBytes(photo.fileSize)} &middot; ${faceSummary}</p>
        <div class="metric-list">${metricMarkup}</div>
        <div class="detail-reason">
          <strong>${picked ? "Why it was picked" : "Why it was filtered"}</strong><br />
          ${escapeHTML(reasonFor(photo))}. ${photo.similarTo ? "A similar burst frame ranked higher." : escapeHTML(purposeConfig[state.purpose].message)}
        </div>
        <button class="${picked ? "secondary-button" : "primary-button"}" id="detailToggle" style="width:100%;margin-top:20px">
          ${picked ? "Remove from picks" : "Add to picks"}
        </button>
      </div>
    </div>
  `;
  els.detailModal.showModal();
  document.querySelector("#detailToggle").addEventListener("click", () => {
    photo.manualPick = !picked;
    els.detailModal.close();
    updateResults();
  });
}

function resetApp() {
  state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
  state.photos = [];
  state.view = "picks";
  state.expressionFilter = "all";
  els.resultsView.classList.add("hidden");
  els.setupView.classList.remove("hidden");
  els.fileInput.value = "";
  els.folderInput.value = "";
  setActiveTabs();
}

function selectedPicks() {
  return state.photos.filter(isPicked).sort((first, second) => first.rank - second.rank);
}

function uniqueFileNames(photos) {
  const used = new Map();
  return photos.map((photo) => {
    const dot = photo.name.lastIndexOf(".");
    const base = dot > 0 ? photo.name.slice(0, dot) : photo.name;
    const extension = dot > 0 ? photo.name.slice(dot) : "";
    const key = photo.name.toLowerCase();
    const count = used.get(key) || 0;
    used.set(key, count + 1);
    return count ? `${base}-${count + 1}${extension}` : photo.name;
  });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function uint16(value) {
  return [value & 255, (value >>> 8) & 255];
}

function uint32(value) {
  return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];
}

async function createZip(photos) {
  const encoder = new TextEncoder();
  const names = uniqueFileNames(photos);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const timestamp = zipDateTime();

  for (let index = 0; index < photos.length; index++) {
    const photo = photos[index];
    const nameBytes = encoder.encode(names[index]);
    const fileBytes = new Uint8Array(await photo.file.arrayBuffer());
    const checksum = crc32(fileBytes);
    const localHeader = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...uint16(20), ...uint16(0x0800), ...uint16(0),
      ...uint16(timestamp.time), ...uint16(timestamp.date),
      ...uint32(checksum), ...uint32(photo.file.size), ...uint32(photo.file.size),
      ...uint16(nameBytes.length), ...uint16(0),
    ]);
    localParts.push(localHeader, nameBytes, photo.file);

    const centralHeader = new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      ...uint16(20), ...uint16(20), ...uint16(0x0800), ...uint16(0),
      ...uint16(timestamp.time), ...uint16(timestamp.date),
      ...uint32(checksum), ...uint32(photo.file.size), ...uint32(photo.file.size),
      ...uint16(nameBytes.length), ...uint16(0), ...uint16(0), ...uint16(0), ...uint16(0),
      ...uint32(0), ...uint32(offset),
    ]);
    centralParts.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + photo.file.size;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endRecord = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...uint16(0), ...uint16(0),
    ...uint16(photos.length), ...uint16(photos.length),
    ...uint32(centralSize), ...uint32(offset),
    ...uint16(0),
  ]);
  return new Blob([...localParts, ...centralParts, endRecord], { type: "application/zip" });
}

async function downloadPicks() {
  const picks = selectedPicks();
  if (!picks.length) {
    showToast("Choose at least one photo first.");
    return;
  }
  const totalBytes = picks.reduce((sum, photo) => sum + photo.file.size, 0);
  if (totalBytes > MAX_ZIP_BYTES) {
    showToast("This selection is too large for a safe ZIP. Use Save to folder instead.");
    return;
  }
  const button = document.querySelector("#downloadPicks");
  button.disabled = true;
  button.innerHTML = "<span>&#10022;</span> Creating ZIP...";
  try {
    const blob = await createZip(picks);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vc-image-sorting-best-${new Date().toISOString().slice(0, 10)}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast(`Downloaded ${picks.length} best pick${picks.length === 1 ? "" : "s"} in one ZIP.`);
  } catch {
    showToast("The ZIP could not be created. Try saving to a folder instead.");
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>&darr;</span> Download ZIP";
  }
}

async function savePicksToFolder() {
  const picks = selectedPicks();
  if (!picks.length) {
    showToast("Choose at least one photo first.");
    return;
  }
  if (!window.showDirectoryPicker) {
    showToast("Folder saving is unavailable here. Use Download ZIP instead.");
    return;
  }
  try {
    const chosenDirectory = await window.showDirectoryPicker({ mode: "readwrite" });
    const outputDirectory = await chosenDirectory.getDirectoryHandle("VC Image Sorting Best Picks", {
      create: true,
    });
    const names = uniqueFileNames(picks);
    for (let index = 0; index < picks.length; index++) {
      const fileHandle = await outputDirectory.getFileHandle(names[index], { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(picks[index].file);
      await writable.close();
    }
    showToast(`${picks.length} best pick${picks.length === 1 ? "" : "s"} saved successfully.`);
  } catch (error) {
    if (error?.name !== "AbortError") {
      showToast("Could not save the folder. Try Download ZIP instead.");
    }
  }
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("visible"), 3200);
}

function readAllDirectoryEntries(reader) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        reject
      );
    };
    readBatch();
  });
}

async function filesFromEntry(entry) {
  if (entry.isFile) {
    return new Promise((resolve) => entry.file((file) => resolve([file]), () => resolve([])));
  }
  if (entry.isDirectory) {
    const entries = await readAllDirectoryEntries(entry.createReader());
    const nested = await Promise.all(entries.map(filesFromEntry));
    return nested.flat();
  }
  return [];
}

async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files];
  const nested = await Promise.all(entries.map(filesFromEntry));
  return nested.flat();
}

function setActiveTabs() {
  document.querySelectorAll(".view-tabs button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
  });
  document.querySelectorAll(".expression-filters button").forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === state.expressionFilter);
  });
}

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true
  );
}

function updateInstallUI() {
  if (els.batchLimitText) {
    els.batchLimitText.textContent =
      `JPEG, PNG, WebP and browser-supported formats. Up to ${MAX_FOLDER_IMAGES} photos per batch${IS_IOS ? " on iPad" : ""}.`;
  }
  if (els.ipadInstall) {
    els.ipadInstall.classList.toggle("installed", isStandaloneApp());
  }
  if (els.installAppButton) {
    els.installAppButton.textContent = deferredInstallPrompt ? "Install" : IS_IOS ? "How to install" : "Install";
  }
}

els.purposeGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".purpose-card");
  if (!button) return;
  state.purpose = button.dataset.purpose;
  document.querySelectorAll(".purpose-card").forEach((item) => {
    item.classList.toggle("active", item === button);
  });
  els.purposeSelect.value = state.purpose;
});

els.fileInput.addEventListener("change", (event) => {
  processFiles(event.target.files);
  event.target.value = "";
});

els.folderInput.addEventListener("change", (event) => {
  processFiles(event.target.files);
  event.target.value = "";
});

["dragenter", "dragover"].forEach((name) => {
  document.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((name) => {
  document.addEventListener(name, (event) => {
    event.preventDefault();
    els.dropZone.classList.remove("dragging");
  });
});

document.addEventListener("drop", async (event) => {
  const files = await filesFromDrop(event.dataTransfer);
  processFiles(files);
});

els.purposeSelect.addEventListener("change", (event) => {
  state.purpose = event.target.value;
  state.photos.forEach((photo) => {
    photo.manualPick = null;
  });
  rankPhotos();
  updateResults();
});

els.pickPercent.addEventListener("input", (event) => {
  state.pickPercent = Number(event.target.value);
  state.photos.forEach((photo) => {
    photo.manualPick = null;
  });
  rankPhotos();
  updateResults();
});

els.viewTabs.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.view = button.dataset.view;
  setActiveTabs();
  renderPhotos();
});

els.expressionFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.expressionFilter = button.dataset.filter;
  setActiveTabs();
  renderPhotos();
});

document.querySelector("#startOver").addEventListener("click", resetApp);
document.querySelector("#downloadPicks").addEventListener("click", downloadPicks);
document.querySelector("#saveFolder").addEventListener("click", savePicksToFolder);
document.querySelector("#closeDetail").addEventListener("click", () => els.detailModal.close());

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallUI();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallUI();
  showToast("VC Image Sorting was installed.");
});

els.installAppButton?.addEventListener("click", async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallUI();
    return;
  }
  if (IS_IOS) {
    showToast("In Safari, tap Share, then choose Add to Home Screen.");
    return;
  }
  showToast("Use your browser menu and choose Install app or Create shortcut.");
});

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "127.0.0.1" || location.hostname === "localhost")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The application remains usable online if offline registration is unavailable.
    });
  });
}

updateFaceModelStatus();
updateInstallUI();
