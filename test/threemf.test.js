import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { inspect3mf, parse3mfModelXml } from '../server/services/threemf.js';

test('aggregates embedded 3MF plates', () => {
  const zip = zipSync({
    '3D/3dmodel.model': strToU8('<model/>'),
    'Metadata/a.gcode': strToU8('; filament_weight = 2\n; estimated time = 1m'),
    'Metadata/b.gcode': strToU8('; filament_weight = 3\n; estimated time = 2m')
  });
  const info = inspect3mf(Buffer.from(zip));
  assert.equal(info.all.weightG, 5);
  assert.equal(info.all.printTimeSec, 180);
});

test('rejects invalid archive', () => assert.throws(() => inspect3mf(Buffer.from('bad')), /Invalid/));

test('accepts meshless sliced 3MF', () => {
  const zip = zipSync({
    'Metadata/plate.gcode': strToU8('; filament_weight = 2\n; estimated time = 1m')
  });
  const info = inspect3mf(Buffer.from(zip));
  assert.equal(info.modelXml, null);
  assert.equal(info.plates.length, 1);
});

test('parses 3MF model geometry', () => {
  const xml = `<?xml version="1.0"?>
<model>
  <resources>
    <object id="1">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="10" y="0" z="0"/>
          <vertex x="0" y="10" z="0"/>
          <vertex x="0" y="0" z="20"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="2" v3="3"/>
        </triangles>
      </mesh>
    </object>
  </resources>
</model>`;
  const geometry = parse3mfModelXml(xml);
  assert.ok(geometry.bboxMm.x >= 10);
  assert.ok(geometry.bboxMm.z >= 20);
  assert.equal(geometry.triangleCount, 2);
});
