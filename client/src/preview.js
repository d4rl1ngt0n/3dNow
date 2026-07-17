import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

function hslLightness(hex) {
  return new THREE.Color(hex).getHSL({}).l;
}

function normalizeFilamentColor(hex) {
  const color = new THREE.Color(hex);
  const hsl = {};
  color.getHSL(hsl);
  if (hsl.l < 0.34) color.setHSL(hsl.h, Math.max(hsl.s, 0.25), 0.34);
  return color;
}

export function createFilamentMaterial(color) {
  const light = hslLightness(color) > 0.72;
  const base = normalizeFilamentColor(color);
  return new THREE.MeshLambertMaterial({
    color: base,
    emissive: new THREE.Color(light ? '#9aa3ad' : base),
    emissiveIntensity: light ? 0.12 : 0.06
  });
}

export function applyPreviewColor(object, color) {
  if (!object) return;
  const material = createFilamentMaterial(color);
  object.traverse(node => {
    if (node.userData?.isPlatePreview) return;
    if (node.userData?.isSolidToolpath || node.isMesh) {
      if (node.material) node.material.dispose();
      node.material = material;
    }
  });
}

function faceNormalAndArea(position, index) {
  const offset = index * 3;
  const a = new THREE.Vector3(position.getX(offset), position.getY(offset), position.getZ(offset));
  const b = new THREE.Vector3(position.getX(offset + 1), position.getY(offset + 1), position.getZ(offset + 1));
  const c = new THREE.Vector3(position.getX(offset + 2), position.getY(offset + 2), position.getZ(offset + 2));
  const normal = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a));
  const doubleArea = normal.length();
  return doubleArea > 0 ? { normal: normal.multiplyScalar(1 / doubleArea), area: doubleArea / 2 } : null;
}

function supportNormalForGeometry(geometry) {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return null;

  const groups = [];
  const maxFaces = Math.min(Math.floor(position.count / 3), 100000);

  for (let face = 0; face < maxFaces; face += 1) {
    const result = faceNormalAndArea(position, face);
    if (!result) continue;
    let group = groups.find(candidate => candidate.normal.dot(result.normal) > 0.995);
    if (!group) {
      group = { normal: result.normal.clone(), area: 0 };
      groups.push(group);
    }
    group.area += result.area;
  }

  groups.sort((a, b) => b.area - a.area);
  return groups[0]?.normal ?? null;
}

export function layMeshFlatOnBed(object) {
  let best = null;
  object.traverse(node => {
    if (!node.isMesh || best) return;
    const normal = supportNormalForGeometry(node.geometry);
    if (normal) best = normal;
  });
  if (!best) return;

  const downward = new THREE.Vector3(0, -1, 0);
  object.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(best, downward));
  object.updateMatrixWorld(true);
}

function refreshObjectBounds(object) {
  object?.traverse(node => {
    if (node.isInstancedMesh) {
      if (!node.boundingBox || node.boundingBox.isEmpty()) node.computeBoundingBox();
      if (!node.boundingSphere) node.computeBoundingSphere();
      node.frustumCulled = false;
      return;
    }
    if (node.isMesh && node.geometry && node.geometry.boundingBox == null) {
      node.geometry.computeBoundingBox();
    }
  });
}

function objectBounds(object) {
  refreshObjectBounds(object);
  const box = new THREE.Box3();
  let found = false;
  object.traverse(node => {
    if (node.isInstancedMesh && node.boundingBox && !node.boundingBox.isEmpty()) {
      const world = node.boundingBox.clone().applyMatrix4(node.matrixWorld);
      if (found) box.union(world);
      else {
        box.copy(world);
        found = true;
      }
      return;
    }
    if (node.isMesh && node.geometry) {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      if (!node.geometry.boundingBox || node.geometry.boundingBox.isEmpty()) return;
      const world = node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld);
      if (found) box.union(world);
      else {
        box.copy(world);
        found = true;
      }
    }
  });
  if (!found) {
    const fallback = new THREE.Box3().setFromObject(object);
    return fallback.isEmpty() ? null : fallback;
  }
  return box;
}

export function alignToPrintBed(object) {
  object.updateMatrixWorld(true);
  const box = objectBounds(object);
  if (!box) return;
  const center = box.getCenter(new THREE.Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}

export function preparePrintPreview(object, { layFlat = false } = {}) {
  if (layFlat) layMeshFlatOnBed(object);
  alignToPrintBed(object);
  return object;
}

function createPlateTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  context.fillStyle = '#2a3036';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(230, 236, 241, 0.13)';
  context.lineWidth = 1;

  for (let position = 0; position <= 512; position += 32) {
    context.beginPath();
    context.moveTo(position, 0);
    context.lineTo(position, 512);
    context.moveTo(0, position);
    context.lineTo(512, position);
    context.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createPlateMarkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '700 152px -apple-system, BlinkMacSystemFont, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = 'rgba(238, 242, 245, 0.72)';
  context.fillText('3D', 390, canvas.height / 2 + 4);
  context.fillStyle = 'rgba(99, 222, 104, 0.92)';
  context.fillText('NOW', 675, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createBed(scene, printer = { name: 'P1S', volume: { x: 256, y: 256 } }) {
  const width = printer.volume?.x || 256;
  const depth = printer.volume?.y || 256;
  const name = printer.name || 'P1S';
  const bed = new THREE.Group();
  bed.name = `${name} build plate`;
  scene.add(bed);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(width + 8, 3.5, depth + 8),
    new THREE.MeshStandardMaterial({
      color: '#7f8a92',
      roughness: 0.42,
      metalness: 0.54
    })
  );
  frame.position.y = -1.8;
  frame.receiveShadow = true;
  bed.add(frame);

  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: createPlateTexture(),
      roughness: 0.77,
      metalness: 0.12
    })
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = 0.02;
  plate.name = `${name} ${width} × ${depth} mm build plate`;
  plate.receiveShadow = true;
  bed.add(plate);

  const gridSize = Math.max(width, depth);
  const grid = new THREE.GridHelper(gridSize, Math.ceil(gridSize / 16), 0x74808a, 0x4a555e);
  grid.scale.set(width / gridSize, 1, depth / gridSize);
  grid.material.opacity = 0.28;
  grid.material.transparent = true;
  grid.position.y = 0.04;
  bed.add(grid);

  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, 0.08, depth)),
    new THREE.LineBasicMaterial({ color: 0xe1e7eb, transparent: true, opacity: 0.58 })
  );
  border.position.y = 0.08;
  bed.add(border);

  const plateMark = new THREE.Mesh(
    new THREE.PlaneGeometry(92, 23),
    new THREE.MeshBasicMaterial({
      map: createPlateMarkTexture(),
      transparent: true,
      depthWrite: false
    })
  );
  plateMark.rotation.x = -Math.PI / 2;
  plateMark.position.set(0, 0.09, depth / 2 - 26);
  plateMark.name = '3DNOW build plate mark';
  bed.add(plateMark);

  return bed;
}

function disposeBed(bed) {
  bed.traverse(node => {
    node.geometry?.dispose();
    if (node.material?.map) node.material.map.dispose();
    if (node.material) node.material.dispose();
  });
}

export class Preview {
  constructor(host) {
    this.host = host;
    this.color = '#FFFFFF';
    this.destroyed = false;
    this.dirty = true;
    this.inView = true;
    this.interacting = false;
    this.dampingUntil = 0;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.raf = 0;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#e9eef2');
    this.scene.fog = new THREE.Fog('#e9eef2', 420, 1400);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.camera.position.set(160, 120, 160);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 720 ? 1.1 : 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 1200;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.addEventListener('start', () => {
      this.interacting = true;
      this.markDirty();
    });
    this.controls.addEventListener('end', () => {
      this.interacting = false;
      this.dampingUntil = performance.now() + 450;
      this.markDirty();
    });
    this.controls.addEventListener('change', () => this.markDirty());

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xdce3ea, 1.25));

    const key = new THREE.DirectionalLight(0xffffff, 1.45);
    key.position.set(110, 190, 95);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 500;
    key.shadow.camera.left = -150;
    key.shadow.camera.right = 150;
    key.shadow.camera.top = 150;
    key.shadow.camera.bottom = -150;
    key.shadow.bias = -0.00015;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xf7fbff, 0.62);
    fill.position.set(-130, 70, -80);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.42);
    rim.position.set(-35, 55, 145);
    this.scene.add(rim);

    this.bed = createBed(this.scene);

    this.resize = new ResizeObserver(() => this.markDirty());
    this.resize.observe(host);

    this.visibility = new IntersectionObserver(entries => {
      this.inView = entries.some(entry => entry.isIntersecting);
      if (this.inView) this.markDirty();
    }, { threshold: 0.05 });
    this.visibility.observe(host);

    this.renderer.domElement.addEventListener('webglcontextlost', event => event.preventDefault());
    this.animate();
  }

  markDirty() {
    this.dirty = true;
    if (!this.raf && !this.destroyed) this.animate();
  }

  set(object, { showBed = true } = {}) {
    this.clear();
    this.object = object;
    this.showBed = showBed;
    this.bed.visible = showBed;
    this.scene.add(object);
    this.setColor(this.color);
    this.fit();
  }

  setBedVisible(showBed) {
    this.showBed = Boolean(showBed);
    if (this.bed) this.bed.visible = this.showBed;
    if (this.object) this.fit();
    this.markDirty();
  }

  setBuildPlate(printer) {
    if (!printer?.volume || this.printerId === printer.id) return;
    disposeBed(this.bed);
    this.scene.remove(this.bed);
    this.bed = createBed(this.scene, printer);
    this.printerId = printer.id;
    this.bed.visible = this.showBed !== false;
    if (this.object) this.fit();
  }

  clear() {
    if (!this.object) return;
    this.scene.remove(this.object);
    this.object.traverse(node => {
      node.geometry?.dispose();
      if (node.material) {
        if (Array.isArray(node.material)) node.material.forEach(material => material.dispose());
        else node.material.dispose();
      }
    });
    this.object = null;
  }

  setColor(color) {
    this.color = color;
    applyPreviewColor(this.object, color);
    this.markDirty();
  }

  fit() {
    if (!this.object) return;
    const box = objectBounds(this.object);
    if (!box) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1);
    const distance = radius * 2.35;
    const target = this.showBed
      ? new THREE.Vector3(center.x, Math.max(center.y, size.y * 0.42), center.z)
      : center;

    this.controls.target.copy(target);
    if (this.showBed) {
      this.camera.position.set(target.x + distance * 0.95, target.y + distance * 0.72, target.z + distance * 0.95);
    } else {
      this.camera.position.copy(target).add(new THREE.Vector3(distance, distance * 0.7, distance));
    }
    this.camera.near = Math.max(0.1, radius / 200);
    this.camera.far = Math.max(radius * 60, distance * 12);
    this.camera.updateProjectionMatrix();
    if (this.scene.fog) {
      this.scene.fog.near = Math.max(distance * 2.4, radius * 4);
      this.scene.fog.far = Math.max(distance * 6, radius * 12);
    }
    this.controls.update();
    this.markDirty();
  }

  reset() {
    this.fit();
  }

  animate() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.destroyed) return;

      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const settling = performance.now() < this.dampingUntil;
      const keepAlive = this.inView && !reduced && (this.controls.autoRotate || this.interacting || settling);

      if (this.inView && (this.dirty || keepAlive)) {
        this.controls.update();
        this.render();
        this.dirty = false;
      }

      if (keepAlive) this.animate();
    });
  }

  render() {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!width || !height) return;
    if (width !== this.lastWidth || height !== this.lastHeight) {
      this.lastWidth = width;
      this.lastHeight = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.visibility.disconnect();
    this.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function setPreviewColor(preview, color) {
  preview?.setColor(color);
}
