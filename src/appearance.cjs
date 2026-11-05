const PET_SIZES = {small: 110, medium: 165, large: 235};
const CHARACTER_IDS = ['chiikawa', 'hachiware', 'usagi', 'kurimanju', 'momonga', 'rakko', 'shisa', 'furuhonya', 'custom'];

function clampPet(bounds, workArea) {
  return {...bounds, x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width))), y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height)))};
}

function panelBounds(pet, workArea, width = 300, height = 194) {
  if (![pet.x, pet.y, pet.width, pet.height, workArea.x, workArea.y, workArea.width, workArea.height, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new TypeError('Invalid geometry');
  if (width > workArea.width || height > workArea.height) return null;
  const gap = 10;
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;
  const besideY = Math.round(Math.max(workArea.y, Math.min(pet.y + pet.height - height, bottom - height)));
  if (pet.x - gap - width >= workArea.x) return {x: pet.x - gap - width, y: besideY, width, height};
  if (pet.x + pet.width + gap + width <= right) return {x: pet.x + pet.width + gap, y: besideY, width, height};
  const aboveX = Math.round(Math.max(workArea.x, Math.min(pet.x + pet.width / 2 - width / 2, right - width)));
  if (pet.y - gap - height >= workArea.y) return {x: aboveX, y: pet.y - gap - height, width, height};
  if (pet.y + pet.height + gap + height <= bottom) return {x: aboveX, y: pet.y + pet.height + gap, width, height};
  return null;
}

function pointInside(point, bounds) {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width && point.y >= bounds.y && point.y < bounds.y + bounds.height;
}

function overlaps(first, second) {
  return first.x < second.x + second.width && first.x + first.width > second.x && first.y < second.y + second.height && first.y + first.height > second.y;
}

function speechBounds(pet, workArea, occupied = null, width = 220, height = 94) {
  if (![pet.x, pet.y, pet.width, pet.height, workArea.x, workArea.y, workArea.width, workArea.height, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new TypeError('Invalid geometry');
  const centerX = pet.x + (pet.width - width) / 2;
  const candidates = [
    {x: centerX, y: pet.y - height - 10},
    {x: pet.x + pet.width + 10, y: pet.y},
    {x: pet.x - width - 10, y: pet.y},
    {x: centerX, y: pet.y + pet.height + 10},
    {x: pet.x + pet.width + 10, y: pet.y + pet.height - height},
    {x: pet.x - width - 10, y: pet.y + pet.height - height}
  ];
  if (occupied) {
    if (![occupied.x, occupied.y, occupied.width, occupied.height].every(Number.isFinite)) throw new TypeError('Invalid geometry');
    candidates.push({x: centerX, y: occupied.y + occupied.height + 10}, {x: centerX, y: occupied.y - height - 10}, {x: occupied.x + occupied.width + 10, y: pet.y}, {x: occupied.x - width - 10, y: pet.y});
  }
  for (const candidate of candidates) {
    const bounds = {x: Math.round(Math.max(workArea.x, Math.min(candidate.x, workArea.x + workArea.width - width))), y: Math.round(Math.max(workArea.y, Math.min(candidate.y, workArea.y + workArea.height - height))), width, height};
    if (width <= workArea.width && height <= workArea.height && !overlaps(bounds, pet) && (!occupied || !overlaps(bounds, occupied))) return bounds;
  }
  return null;
}

module.exports = {PET_SIZES, CHARACTER_IDS, clampPet, panelBounds, pointInside, speechBounds, overlaps};
