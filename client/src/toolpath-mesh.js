import * as THREE from 'three';

const matrix = new THREE.Matrix4();

export function buildSolidToolpathMesh(voxels, material, {
  voxelSize = 2.4,
  onProgress
} = {}) {
  if (!voxels?.length) return null;

  const size = Math.max(1.2, voxelSize);
  // Slight overlap removes the grainy gaps between cells.
  const edge = size * 1.08;
  const geometry = new THREE.BoxGeometry(edge, edge, edge);
  const mesh = new THREE.InstancedMesh(geometry, material, voxels.length);
  mesh.userData.isSolidToolpath = true;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

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
  if (onProgress) onProgress(100);
  return mesh;
}
