const mapViewer = window.bluemap.mapViewer;
const renderer = mapViewer.renderer;
const THREE = window.BlueMap.Three;
const LineMarker = window.BlueMap.LineMarker;
const scene = new THREE.Scene();

const host = "https://trainmap.ftbgobrrr.com"; // CHANGE HOST to create track train url
const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);

const marker = new BlueMap.LineMarker().line;
const Line2 = Object.getPrototypeOf(marker.constructor);
const LineMaterial = marker.material.constructor;
const LineGeometry = marker.geometry.constructor;

const lineMaterial = new LineMaterial({
  linewidth: 2,
  color: 0xffff00,
  resolution,
});

const lineMaterialReserved = new LineMaterial({
  linewidth: 2,
  color: 0xff0000,
  resolution,
});

const stationGeometry = new THREE.BoxGeometry(1, 1, 1);
const stationMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });

const signalGeometry = new LineGeometry();
signalGeometry.setPositions([-1, 0, -1, 0, 0, 0, 1, 0, -1]);
const signalRedMaterial = new LineMaterial({
  color: 0xff0000,
  linewidth: 2,
  resolution,
});
const signalGreenMaterial = new LineMaterial({
  color: 0x00ff00,
  linewidth: 2,
  resolution,
});
const signalYellowMaterial = new LineMaterial({
  color: 0xffff00,
  linewidth: 2,
  resolution,
});

const objects = {
  tracks: new Map(),
  stations: new Map(),
  blocks: new Map(),
  signals: new Map(),
  trains: new Map(),
  trainsNames: new Map(),
};

function updateObjects(scene, map, data, createFn, updateFn) {
  const existingKeys = new Set(map.keys());
  data.forEach((item, index) => {
    const id = item.id;
    if (!id) throw "no id";
    if (map.has(id)) {
      updateFn(map.get(id), item, index);
    } else {
      const obj = createFn(item, index);
      scene.add(obj);
      map.set(id, obj);
    }
    existingKeys.delete(id);
  });
  existingKeys.forEach((id) => {
    scene.remove(map.get(id));
    map.delete(id);
  });
}

function updateSceneObjects(map, data, createFn, updateFn) {
  updateObjects(scene, map, data, createFn, updateFn);
}

function updateMarkerObjects(map, data, createFn, updateFn) {
  updateObjects(mapViewer.markers, map, data, createFn, updateFn);
}

this.networkStream = new EventSource(`${host}/api/network.rt`);
this.networkStream.onmessage = (e) => {
  const data = JSON.parse(e.data);
  updateSceneObjects(
    objects.tracks,
    data.tracks.map((track) => ({ ...track, id: JSON.stringify(track.path) })),
    ({ path }) => {
      const lineGeometry = new LineGeometry();
      lineGeometry.setPositions(path.flatMap((p) => [p.x, p.y, p.z]));
      const line = new Line2(lineGeometry, lineMaterial);
      return line;
    },
    (line, { path }) => {
      line.geometry.setPositions(path.flatMap((p) => [p.x, p.y, p.z]));
      line.geometry.attributes.position.needsUpdate = true;
    }
  );

  updateSceneObjects(
    objects.stations,
    data.stations,
    ({ location }) => {
      const cube = new THREE.Mesh(stationGeometry, stationMaterial);
      cube.position.set(location.x, location.y, location.z);
      return cube;
    },
    (cube, { location }) => {
      cube.position.set(location.x, location.y, location.z);
    }
  );
};

this.blocksStream = new EventSource(`${host}/api/blocks.rt`);
this.blocksStream.onmessage = (e) => {
  const data = JSON.parse(e.data);
  updateSceneObjects(
    objects.blocks,
    data.blocks
      .flatMap((block) =>
        block.reserved || block.occupied ? block.segments : []
      )
      .map((segment) => ({ ...segment, id: JSON.stringify(segment.path) })),
    ({ path }) => {
      const lineGeometry = new LineGeometry();
      lineGeometry.setPositions(path.flatMap((p) => [p.x, p.y + 0.01, p.z]));
      const line = new Line2(lineGeometry, lineMaterialReserved);
      return line;
    },
    (line, { path }) => {
      line.geometry.setPositions(path.flatMap((p) => [p.x, p.y + 0.01, p.z]));
      line.geometry.attributes.position.needsUpdate = true;
    }
  );
};

const updateTrain = (cube, { car, train, index }) => {
  const leading = new THREE.Vector3(
    car.leading.location.x,
    car.leading.location.y,
    car.leading.location.z
  );
  const trailing = new THREE.Vector3(
    car.trailing.location.x,
    car.trailing.location.y,
    car.trailing.location.z
  );
  let carLength = 0;
  let direction = new THREE.Vector3();

  if (index < train.cars.length - 1) {
    const nextLeading = new THREE.Vector3(
      train.cars[index + 1].leading.location.x,
      train.cars[index + 1].leading.location.y,
      train.cars[index + 1].leading.location.z
    );
    carLength = leading.distanceTo(nextLeading);
  } else if (index > 0) {
    const prevLeading = new THREE.Vector3(
      train.cars[index - 1].leading.location.x,
      train.cars[index - 1].leading.location.y,
      train.cars[index - 1].leading.location.z
    );
    carLength = leading.distanceTo(prevLeading);
  } else {
    carLength = leading.distanceTo(trailing);
  }
  direction.subVectors(trailing, leading).normalize();
  cube.position.set(leading.x, leading.y, leading.z);
  cube.rotation.y = Math.atan2(direction.x, direction.z);
  cube.scale.set(5, 5, carLength * 0.8);
};

const trainVelocities = new Map();
const previousTrainPositions = new Map();
this.trainStatusStream = new EventSource(`${host}/api/trains.rt`);
this.trainStatusStream.onmessage = (e) => {
  const data = JSON.parse(e.data);
  const currentTime = performance.now();
  // updateMarkerObjects(
  //   objects.trainsNames,
  //   data.trains.map((train) => ({
  //     name: train.name,
  //     id: train.id,
  //     position: train.cars[Math.floor(train.cars.length / 2)].leading.location,
  //   })),
  //   (data) => {
  //     const marker = new BlueMap.HtmlMarker();
  //     marker.html = `
  //       <div id="bm-marker-train-${data.id}" class="bm-marker-player">
  //           <div class="bm-player-name">${data.name}</div>
  //       </div>
  //     `;
  //     return marker;
  //   },
  //   (marker, data, _) => {
  //     marker.position.x = data.position.x;
  //     marker.position.y = data.position.y + 2;
  //     marker.position.z = data.position.z;
  //   }
  // );

  updateSceneObjects(
    objects.trains,
    data.trains.flatMap((train) =>
      train.cars.map((car, index) => ({
        car,
        train,
        index,
        id: `${train.id}:${index}`,
      }))
    ),
    (data) => {
      const cube = new THREE.Mesh(stationGeometry, stationMaterial);
      updateTrain(cube, data);
      previousTrainPositions.set(data.id, {
        position: cube.position.clone(),
        time: currentTime,
      });

      return cube;
    },
    (cube, data, _) => {
      const prevData = previousTrainPositions.get(data.id);
      const newPosition = new THREE.Vector3(
        data.car.leading.location.x,
        data.car.leading.location.y,
        data.car.leading.location.z
      );

      if (prevData) {
        const dt = (currentTime - prevData.time) / 1000;
        const velocity = newPosition
          .clone()
          .sub(prevData.position)
          .divideScalar(dt || 1);
        trainVelocities.set(data.id, velocity);
      }

      previousTrainPositions.set(data.id, {
        position: newPosition.clone(),
        time: currentTime,
      });

      updateTrain(cube, data);
    }
  );
};

const selectMaterial = {
  RED: signalRedMaterial,
  GREEN: signalGreenMaterial,
  YELLOW: signalYellowMaterial,
};

const updateSignal = (line, { location, forward, reverse }) => {
  const state = { ...forward, ...reverse };
  line.material = selectMaterial[state.state];
  let vector = new THREE.Vector3(2, 0, 0);
  vector.applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    (-state.angle * Math.PI) / 180
  );

  line.position.x = location.x + vector.x;
  line.position.y = location.y;
  line.position.z = location.z + vector.z;
  line.rotation.y =
    (forward ? -Math.PI : Math.PI) + (-state.angle * Math.PI) / 180;
};
this.signalsStream = new EventSource(`${host}/api/signals.rt`);
this.signalsStream.onmessage = (e) => {
  const data = JSON.parse(e.data);
  updateSceneObjects(
    objects.signals,
    data.signals.map((signal) => ({
      ...signal,
      id: JSON.stringify(signal.location),
    })),
    (data) => {
      const line = new Line2(signalGeometry, selectMaterial["RED"]);
      updateSignal(line, data);
      return line;
    },
    (line, data) => {
      updateSignal(line, data);
    }
  );
};

window.addEventListener("resize", () => {
  lineMaterial.resolution.set(window.innerWidth, window.innerHeight);
  lineMaterialReserved.resolution.set(window.innerWidth, window.innerHeight);
  signalRedMaterial.resolution.set(window.innerWidth, window.innerHeight);
  signalGreenMaterial.resolution.set(window.innerWidth, window.innerHeight);
  signalYellowMaterial.resolution.set(window.innerWidth, window.innerHeight);
  lineMaterial.needsUpdate = true;
  lineMaterialReserved.needsUpdate = true;
  signalRedMaterial.needsUpdate = true;
  signalGreenMaterial.needsUpdate = true;
  signalYellowMaterial.needsUpdate = true;
});

hijack(
  mapViewer,
  "render",
  (override) =>
    function (delta) {
      override.call(this, delta);

      objects.trains.forEach((cube, id) => {
        const velocity = trainVelocities.get(id);
        if (velocity) {
          const dt = delta / 1000;
          cube.position.add(velocity.clone().multiplyScalar(dt));
        }
      });

      renderer.clearDepth();
      renderer.render(scene, mapViewer.camera);
    }
);

function hijack(object, funcName, override) {
  object[funcName] = override(object[funcName]);
}
