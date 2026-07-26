(function (global) {
  "use strict";

  // Static reference locations.  They are deliberately separate from notice-area
  // assignments so that staff, areas, and shared data are never changed by this layer.
  const LANDMARKS = Object.freeze([
    {
      id: "phra-prang-sam-yot",
      name: "พระปรางค์สามยอด",
      district: "เมืองลพบุรี",
      tambon: "ท่าหิน",
      category: "โบราณสถาน",
      type: "historic",
      icon: "♜",
      coordinates: [100.614113, 14.80292],
      description: "จุดอ้างอิงโบราณสถานสำคัญในเขตเมืองลพบุรี",
    },
    {
      id: "sub-lek-reservoir",
      name: "อ่างเก็บน้ำซับเหล็ก",
      district: "เมืองลพบุรี",
      tambon: "นิคมสร้างตนเอง",
      category: "แหล่งน้ำ",
      type: "water",
      icon: "≋",
      coordinates: [100.78144, 14.82381],
      description: "จุดอ้างอิงแหล่งน้ำสำคัญทางตะวันออกของอำเภอเมืองลพบุรี",
    },
    {
      id: "khao-wong-phrachan",
      name: "เขาวงพระจันทร์",
      district: "โคกสำโรง",
      tambon: "ห้วยโป่ง",
      category: "ภูเขาและศาสนสถาน",
      type: "mountain",
      icon: "▲",
      coordinates: [100.697441, 14.966919],
      description: "จุดอ้างอิงภูเขาสำคัญของอำเภอโคกสำโรง",
    },
    {
      id: "pa-sak-cholasit-dam",
      name: "เขื่อนป่าสักชลสิทธิ์",
      district: "พัฒนานิคม",
      tambon: "หนองบัว",
      category: "เขื่อนและแหล่งน้ำ",
      type: "dam",
      icon: "▰",
      coordinates: [101.059667, 14.856831],
      description: "จุดอ้างอิงเขื่อนป่าสักชลสิทธิ์ในเขตอำเภอพัฒนานิคม",
    },
    {
      id: "wat-khao-samo-khon",
      name: "วัดเขาสมอคอน",
      district: "ท่าวุ้ง",
      tambon: "เขาสมอคอน",
      category: "วัดและภูเขา",
      type: "temple",
      icon: "⌂",
      coordinates: [100.507778, 14.900833],
      description: "จุดอ้างอิงวัดบนเขาสมอคอนของอำเภอท่าวุ้ง",
    },
    {
      id: "ban-mi-station",
      name: "สถานีรถไฟบ้านหมี่",
      district: "บ้านหมี่",
      tambon: "บ้านหมี่",
      category: "คมนาคม",
      type: "station",
      icon: "✦",
      coordinates: [100.540222, 15.039789],
      description: "จุดอ้างอิงคมนาคมในเขตอำเภอบ้านหมี่",
    },
    {
      id: "wat-khao-lamphaen",
      name: "วัดเขาลำแพน",
      district: "หนองม่วง",
      tambon: "บ่อทอง",
      category: "วัดและภูเขา",
      type: "temple",
      icon: "⌂",
      coordinates: [100.61836, 15.2525],
      description: "จุดอ้างอิงวัดบนเขาในตำบลบ่อทอง อำเภอหนองม่วง",
    },
  ]);

  function all() {
    return LANDMARKS.map((landmark) => ({ ...landmark, coordinates: [...landmark.coordinates] }));
  }

  global.LopburiLandmarks = Object.freeze({ VERSION: 1, all });
})(typeof globalThis !== "undefined" ? globalThis : this);
