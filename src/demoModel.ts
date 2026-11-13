import * as THREE from 'three';

/**
 * 内置演示模型(单位:mm)。
 * 结构:
 *  DemoAssembly
 *   ├─ BasePlate   底板 120×80×10,中心有 Ø30 通孔(空腔)
 *   ├─ Pin         销 Ø16×30,插在孔内(被 CoverBlock 遮挡,剖切后可见)
 *   ├─ CoverBlock  盖板 60×40×20,压在孔上方(遮挡关系)
 *   └─ ArmAssembly 摆臂组(绕 Y 旋转 30°,平移)
 *       └─ ShaftGroup 轴组(绕 Z 旋转 15°,非等比缩放 1,2,1)
 *           └─ Shaft   轴 Ø10×50(缩放后世界长度 100)
 */
export const DEMO_SPECS = [
  '底板 BasePlate: 120 × 80 × 10 mm,中心通孔 Ø30 mm',
  '销 Pin: Ø16 × 30 mm,位于孔内(被盖板遮挡)',
  '盖板 CoverBlock: 60 × 40 × 20 mm,底面贴底板顶面',
  '轴 Shaft: Ø10 mm,局部长度 50 mm,经 2 倍缩放后世界长度 100 mm',
  '轴所在组:绕 Z 旋转 15°,非等比缩放 (1, 2, 1);父组绕 Y 旋转 30°',
];

function mat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25 });
}

export function buildDemoModel(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'DemoAssembly';

  // 底板:120×80 圆角矩形,中心 Ø30 通孔,厚度 10
  const shape = new THREE.Shape();
  const w = 120, h = 80, r = 8;
  shape.moveTo(-w / 2 + r, -h / 2);
  shape.lineTo(w / 2 - r, -h / 2);
  shape.absarc(w / 2 - r, -h / 2 + r, r, -Math.PI / 2, 0);
  shape.lineTo(w / 2, h / 2 - r);
  shape.absarc(w / 2 - r, h / 2 - r, r, 0, Math.PI / 2);
  shape.lineTo(-w / 2 + r, h / 2);
  shape.absarc(-w / 2 + r, h / 2 - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-w / 2, -h / 2 + r);
  shape.absarc(-w / 2 + r, -h / 2 + r, r, Math.PI, Math.PI * 1.5);
  const hole = new THREE.Path();
  hole.absarc(0, 0, 15, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const plateGeo = new THREE.ExtrudeGeometry(shape, { depth: 10, bevelEnabled: false });
  plateGeo.rotateX(-Math.PI / 2); // 放平:y 0..10
  const plate = new THREE.Mesh(plateGeo, mat(0x7f8c9b));
  plate.name = 'BasePlate';
  root.add(plate);

  // 销:插在孔里,顶面 y=20,被盖板遮住
  const pinGeo = new THREE.CylinderGeometry(8, 8, 30, 48);
  const pin = new THREE.Mesh(pinGeo, mat(0xc0a060));
  pin.position.set(0, 5, 0); // y: -10..20
  pin.name = 'Pin';
  root.add(pin);

  // 盖板:60×40×20,坐在底板顶面(y=10)上,盖住孔
  const coverGeo = new THREE.BoxGeometry(60, 20, 40);
  const cover = new THREE.Mesh(coverGeo, mat(0x4f7fb5));
  cover.position.set(10, 20, 0); // y: 10..30
  cover.name = 'CoverBlock';
  root.add(cover);

  // 摆臂组:平移 + 绕 Y 旋转 30°
  const arm = new THREE.Group();
  arm.name = 'ArmAssembly';
  arm.position.set(40, 10, 20);
  arm.rotation.y = THREE.MathUtils.degToRad(30);

  // 轴组:绕 Z 旋转 15°,非等比缩放 (1,2,1)
  const shaftGroup = new THREE.Group();
  shaftGroup.name = 'ShaftGroup';
  shaftGroup.rotation.z = THREE.MathUtils.degToRad(15);
  shaftGroup.scale.set(1, 2, 1);

  const shaftGeo = new THREE.CylinderGeometry(5, 5, 50, 32);
  const shaft = new THREE.Mesh(shaftGeo, mat(0xb5544f));
  shaft.position.set(0, 25, 0); // 局部 y: 0..50 → 世界缩放后长度 100
  shaft.name = 'Shaft';
  shaftGroup.add(shaft);
  arm.add(shaftGroup);
  root.add(arm);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return root;
}
