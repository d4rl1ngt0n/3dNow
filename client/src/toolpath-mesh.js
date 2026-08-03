import * as THREE from 'three';

const matrix = new THREE.Matrix4();
const ORBIT_INSTANCE_CAP = 4500;

function fillInstancedMesh(mesh, voxels, edge, onProgress) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let index = 0; index < voxels.length; index += 1) {
    if (onProgress && index % 4000 === 0) onProgress(Math.min(99, Math.round((index / voxels.length) * 100)));
    const voxel = voxels[index];
    const x = voxel[0];
    const y = voxel[1];
    const z = voxel[2];
    matrix.makeTranslation(x, y, z);
    mesh.setMatrixAt(index, matrix);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  mesh.instanceMatrix.needsUpdate = true;
  const half = edge / 2;
  mesh.boundingBox = new THREE.Box3(
    new THREE.Vector3(minX - half, minY - half, minZ - half),
    new THREE.Vector3(maxX + half, maxY + half, maxZ + half)
  );
  mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(new THREE.Sphere());
}

function createVoxelMesh(voxels, material, edge, { orbitProxy = false, onProgress } = {}) {
  const geometry = new THREE.BoxGeometry(edge, edge, edge);
  const mesh = new THREE.InstancedMesh(geometry, material, voxels.length);
  mesh.userData.isSolidToolpath = true;
  mesh.userData.isOrbitProxy = orbitProxy;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  fillInstancedMesh(mesh, voxels, edge, onProgress);
  return mesh;
}

function strideVoxels(voxels, cap) {
  if (voxels.length <= cap) return null;
  const step = Math.ceil(voxels.length / cap);
  const sparse = [];
  for (let index = 0; index < voxels.length; index += step) sparse.push(voxels[index]);
  return sparse;
}

export function buildSolidToolpathMesh(voxels, material, {
  voxelSize = 2.4,
  onProgress
} = {}) {
  if (!voxels?.length) return null;

  const size = Math.max(1.2, voxelSize);
  // Slight overlap removes the grainy gaps between cells.
  const edge = size * 1.08;
  const mesh = createVoxelMesh(voxels, material, edge, { onProgress });

  const sparse = strideVoxels(voxels, ORBIT_INSTANCE_CAP);
  if (!sparse) {
    if (onProgress) onProgress(100);
    return mesh;
  }

  const proxy = createVoxelMesh(sparse, material, edge, { orbitProxy: true });
  proxy.visible = false;

  // Group so align/fit/color move full + sparse meshes together.
  const group = new THREE.Group();
  group.userData.isSolidToolpath = true;
  group.userData.hasOrbitProxy = true;
  group.add(mesh);
  group.add(proxy);
  if (onProgress) onProgress(100);
  return group;
}

/** While orbiting, draw the sparse proxy instead of the full voxel cloud. */
export function setToolpathOrbitMode(root, orbiting) {
  root?.traverse(node => {
    if (!node.isInstancedMesh || !node.userData?.isSolidToolpath) return;
    if (node.userData.isOrbitProxy) {
      node.visible = Boolean(orbiting);
      return;
    }
    const hasProxy = node.parent?.children?.some(child => child.userData?.isOrbitProxy);
    if (hasProxy) node.visible = !orbiting;
  });
}
