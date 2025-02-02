const { useMemo, useState, useRef } = React = require('react')
const { useThree, useRender } = require('react-three-fiber')
const { useSelector, useDispatch } = require('react-redux')
const useReduxStore = require('react-redux').useStore

const { create } = require('zustand')
const { produce } = require('immer')

const useVrControllers = require('./hooks/use-vr-controllers')

const { log } = require('./components/Log')

const getControllerIntersections = require('./helpers/get-controller-intersections')
const findMatchingAncestor = require('./helpers/find-matching-ancestor')
const rotatePoint = require('./helpers/rotate-point')
const teleportParent = require('./helpers/teleport-parent')
const applyDeviceQuaternion = require('../../shot-generator/apply-device-quaternion')

const BonesHelper = require('./three/BonesHelper')
const GPUPicker = require('./three/GPUPickers/GPUPicker')

const { interpret } = require('xstate/lib/interpreter')
const interactionMachine = require('./machines/interactionMachine')

const {
  // selectors
  getSelections,
  getSelectedBone,

  // action creators
  selectObject,
  updateObject,
  updateCharacterSkeleton,

  selectBone
} = require('../../shared/reducers/shot-generator')

const getRotationMemento = (controller, object) => {
  let controllerRot = new THREE.Matrix4().extractRotation(controller.matrixWorld)
  let startingDeviceRotation = new THREE.Quaternion().setFromRotationMatrix(controllerRot)
  let startingDeviceOffset = new THREE.Quaternion()
    .clone()
    .inverse()
    .multiply(startingDeviceRotation)
    .normalize()
    .inverse()

  let startingObjectQuaternion = object.quaternion.clone()
  let startingObjectOffset = new THREE.Quaternion()
    .clone()
    .inverse()
    .multiply(startingObjectQuaternion)

  return {
    startingDeviceOffset,
    startingObjectOffset,
    startingObjectQuaternion
  }
}

const getSelectOffset = (controller, object, distance, point) => {
  let cursor = controller.getObjectByName('cursor')
  cursor.position.z = -distance
  const pos = object.getWorldPosition(new THREE.Vector3())
  const offset = new THREE.Vector3().subVectors(point, pos)
  return offset
}

// TODO test worldScale
const moveObjectZ = (object, event, worldScale) => {
  if (Math.abs(event.axes[1]) < Math.abs(event.axes[0])) return

  const amount = event.axes[1] * 0.08

  if (Math.abs(amount) > 0.01) {
    const worldScaleMult = worldScale === 1 ? 1 : worldScale * 2

    object.position.add(new THREE.Vector3(0, 0, amount * worldScaleMult))
    object.position.z = Math.min(object.position.z, -0.5 * worldScaleMult)
  }
}

// TODO test worldScale
const rotateObjectY = (object, event) => {
  if (Math.abs(event.axes[0]) < Math.abs(event.axes[1])) return

  const amount = event.axes[0] * 0.07

  if (Math.abs(amount) > 0.01) {
    object.rotateY(amount)
  }
}

// TODO worldScale
const snapObjectRotation = (object, controller, worldScale = 1) => {
  object.matrix.premultiply(controller.matrixWorld)
  object.matrix.decompose(object.position, object.quaternion, new THREE.Vector3())
  object.scale.set(object.scale.x / worldScale, object.scale.y / worldScale, object.scale.z / worldScale)
  object.position.multiplyScalar(1 / worldScale)

  object.userData.order = object.rotation.order
  object.rotation.reorder('YXZ')

  const sign = Math.sign(object.rotation.y)
  let degreeY = THREE.Math.radToDeg(Math.abs(object.rotation.y)) / 22.5
  degreeY = THREE.Math.degToRad(Math.round(degreeY) * 22.5) * sign

  let degreeZ = THREE.Math.radToDeg(Math.abs(object.rotation.z)) / 180
  degreeZ = THREE.Math.degToRad(Math.round(degreeZ) * 180)

  object.rotation.x = 0
  object.rotation.z = degreeZ
  object.rotation.y = degreeY
  object.rotation.order = object.userData.order
}

const teleportState = ({ teleportPos, teleportRot }, camera, x, y, z, r) => {
  // create virtual parent and child
  let parent = new THREE.Object3D()
  parent.position.set(teleportPos.x, teleportPos.y, teleportPos.z)
  parent.rotation.set(teleportRot.x, teleportRot.y, teleportRot.z)

  let child = new THREE.Object3D()
  child.position.copy(camera.position)
  child.rotation.copy(camera.rotation)
  parent.add(child)
  parent.updateMatrixWorld()

  // teleport the virtual parent
  teleportParent(parent, child, x, y, z, r)

  // update state from new position of virtual parent
  teleportPos.x = parent.position.x
  teleportPos.y = parent.position.y
  teleportPos.z = parent.position.z

  teleportRot.x = parent.rotation.x
  teleportRot.y = parent.rotation.y
  teleportRot.z = parent.rotation.z
}

const [useStore, useStoreApi] = create((set, get) => ({
  // values
  teleportPos: { x: 0, y: 0, z: 0 },
  teleportRot: { x: 0, y: 0, z: 0 },

  didMoveCamera: null,
  didRotateCamera: null,

  teleportMaxDist: 10,
  teleportMode: false,
  teleportTargetPos: [0, 0, 0],
  teleportTargetValid: false,

  boneRotationMemento: {},

  canSnap: false,

  // actions
  setDidMoveCamera: value => set(produce(state => { state.didMoveCamera = value })),
  setDidRotateCamera: value => set(produce(state => { state.didRotateCamera = value })),
  setTeleportMode: value => set(state => ({ ...state, teleportMode: value })),

  moveCameraByDistance: (camera, distance) => set(produce(state => {
    let center = new THREE.Vector3()
    camera.getWorldPosition(center)
    let gr = camera.rotation.y + state.teleportRot.y

    let target = new THREE.Vector3(center.x, 0, center.z + distance)
    let d = rotatePoint(target, center, -gr)
    teleportState(state, camera, d.x, null, d.z, null)
  })),

  rotateCameraByRadians: (camera, radians) => set(produce(state => {
    let center = new THREE.Vector3()
    camera.getWorldPosition(center)
    let gr = camera.rotation.y + state.teleportRot.y

    teleportState(state, camera, null, null, null, gr + radians)
  })),

  teleport: (camera, x, y, z, r) => set(produce(state => {
    teleportState(state, camera, x, y, z, r)
  })),

  set: fn => set(produce(fn))
}))

const useInteractionsManager = ({
  groundRef
}) => {
  const { gl, camera, scene } = useThree()

  const selections = useSelector(getSelections)

  const gpuPicker = useRef(null)

  const getGpuPicker = () => {
    if (gpuPicker.current === null) {
      gpuPicker.current = new GPUPicker(gl)
    }
    return gpuPicker.current
  }

  // values
  const didMoveCamera = useStore(state => state.didMoveCamera)
  const didRotateCamera = useStore(state => state.didRotateCamera)
  const teleportMode = useStore(state => state.teleportMode)
  const teleportTargetValid = useStore(state => state.teleportTargetValid)
  const teleportMaxDist = useStore(state => state.teleportMaxDist)

  // actions
  const setDidMoveCamera = useStore(state => state.setDidMoveCamera)
  const setDidRotateCamera = useStore(state => state.setDidRotateCamera)
  const moveCameraByDistance = useStore(state => state.moveCameraByDistance)
  const rotateCameraByRadians = useStore(state => state.rotateCameraByRadians)
  const teleportFn = useStore(state => state.teleport)
  const teleport = (x, y, z, r) => teleportFn(camera, x, y, z, r)
  const setTeleportMode = useStore(state => state.setTeleportMode)
  const set = useStore(state => state.set)

  const store = useReduxStore()
  const dispatch = useDispatch()

  const oppositeController = controller => controllers.find(i => i.uuid !== controller.uuid)

  const onTriggerStart = event => {
    const controller = event.target

    let intersection = null

    // TODO selecting GUI objects

    // if the BonesHelper instance is in the scene ...
    if ( BonesHelper.getInstance().isSelected ) {
      // ... check bones helper bone intersections
      intersection = getControllerIntersections(controller, [BonesHelper.getInstance()]).find(h => h.bone)
      if (intersection) {
        interactionService.send({
          type: 'TRIGGER_START',
          controller: event.target,
          intersection: {
            id: intersection.object.userData.id,
            type: 'bone',

            object: intersection.object,
            distance: intersection.distance,
            point: intersection.point,

            bone: intersection.bone
          }
        })
        return
      }
    }

    let match = null

    // include all interactables (Model Object, Character, etc)
    let list = scene.__interaction

    // setup the GPU picker
    getGpuPicker().setupScene(list)

    // gather all hits to tracked scene object3ds
    let hits = getGpuPicker().pick(controller.worldPosition(), controller.worldQuaternion())

    // if one intersects
    if (hits.length) {
      // grab the first intersection
      let child = hits[0].object
      // find either the child or one of its parents on the list of interaction-ables
      match = findMatchingAncestor(child, list)
      if (match) {
        intersection = hits[0]
      }
    }

    if (match) {
      // console.log('found sceneObject:', sceneObjects[match.userData.id])
      // console.log('intersection', intersection)
      // log(`select ${sceneObjects[match.userData.id].name || sceneObjects[match.userData.id].displayName}`)
      log(`trigger start on: ${match.userData.id.slice(0, 7)}`)

      interactionService.send({
        type: 'TRIGGER_START',
        controller: event.target,
        intersection: {
          id: match.userData.id,
          type: match.userData.type,
          object: match,
          distance: intersection.distance,
          point: intersection.point
        }
      })
    } else {
      // console.log('clearing selection')
      log(`trigger start on: none`)
      interactionService.send({ type: 'TRIGGER_START', controller: event.target })
    }
  }

  const onTriggerEnd = event => {
    interactionService.send({ type: 'TRIGGER_END', controller: event.target })
  }

  const onGripDown = event => {
    const controller = event.target

    if (BonesHelper.getInstance().isSelected) {
      const intersection = getControllerIntersections(controller, [BonesHelper.getInstance()]).find(h => h.bone)
      if (intersection) {
        interactionService.send({
          type: 'GRIP_DOWN',
          controller: event.target,

          intersection: intersection ? { ...intersection, type: 'bone' } : undefined
        })
        return
      }
    }

    let match = null

    // include all interactables (Model Object, Character, etc)
    let list = scene.__interaction

    // setup the GPU picker
    getGpuPicker().setupScene(list)

    // gather all hits to tracked scene object3ds
    let hits = getGpuPicker().pick(controller.worldPosition(), controller.worldQuaternion())

    // if one intersects
    if (hits.length) {
      // grab the first intersection
      let child = hits[0].object
      // find either the child or one of its parents on the list of interaction-ables
      match = findMatchingAncestor(child, list)
      if (match) {
        intersection = hits[0]
      }
    }

    if (match) {
      interactionService.send({
        type: 'GRIP_DOWN',
        controller: event.target,

        intersection: {
          id: match.userData.id,
          type: match.userData.type,
          object: match,
          distance: intersection.distance,
          point: intersection.point
        }
      })
    } else {
      interactionService.send({
        type: 'GRIP_DOWN',
        controller: event.target,

        intersection: undefined
      })
    }
  }

  const onGripUp = event => {
    interactionService.send({ type: 'GRIP_UP', controller: event.target })
  }

  const onAxesChanged = event => {
    interactionService.send({ type: 'AXES_CHANGED', controller: event.target, axes: event.axes })
  }

  const onMoveCamera = event => {
    if (didMoveCamera != null) {
      if (event.axes[1] === 0) {
        setDidMoveCamera(null)
      }
    } else {
      if (Math.abs(event.axes[1]) < Math.abs(event.axes[0])) return

      let distance
      let value = event.axes[1]

      // backward
      if (value > 0.075) {
        distance = +1
      }

      // forward
      if (value < -0.075) {
        distance = -1
      }

      if (distance != null) {
        setDidMoveCamera(distance)
        moveCameraByDistance(camera, distance)
      }
    }
  }

  const onRotateCamera = event => {
    if (didRotateCamera != null) {
      if (event.axes[0] === 0) {
        setDidRotateCamera(null)
      }
    } else {
      if (Math.abs(event.axes[0]) < Math.abs(event.axes[1])) return

      // right
      if (event.axes[0] > 0.075) {
        setDidRotateCamera(-45)
        rotateCameraByRadians(camera, THREE.Math.degToRad(-45))
      }

      // left
      if (event.axes[0] < -0.075) {
        setDidRotateCamera(45)
        rotateCameraByRadians(camera, THREE.Math.degToRad(45))
      }
    }
  }

  // controller state via THREE.VRController
  const controllers = useVrControllers({
    onTriggerStart,
    onTriggerEnd,
    onGripDown,
    onGripUp,
    onAxesChanged
  })

  // TODO could model these as ... activities? exec:'render' actions?
  useRender(() => {
    // don't wait for a React update
    // read values directly from stores
    let teleportMode = useStoreApi.getState().teleportMode
    let selections = getSelections(store.getState())
    let selectedId = selections.length ? selections[0] : null

    let mode = interactionService.state.value
    let context = interactionService.state.context

    // highlight hovered bone
    if (mode == 'selected') {
      let match
      for (let i = 0, n = controllers.length; i < n; i++) {
        let controller = controllers[i]
        let intersection = getControllerIntersections(controller, [BonesHelper.getInstance()]).find(h => h.bone)
        if (intersection) {
          match = intersection
          BonesHelper.getInstance().selectBone(intersection.bone)
        }
      }
      if (!match) {
        BonesHelper.getInstance().resetSelection()
      }
    }

    if (mode === 'drag_teleport') {
      let controller = gl.vr.getController(context.teleportDragController)

      let hits = getControllerIntersections(controller, [groundRef.current])
      if (hits.length) {
        let hit = hits[0]
        if (hit.distance < teleportMaxDist) {
          let teleportTargetPos = hit.point.toArray()
          set(state => ({ ...state, teleportTargetPos, teleportTargetValid: true }))
        } else {
          set(state => ({ ...state, teleportTargetValid: false }))
        }
      }
    }

    if (mode == 'drag_object') {
      let controller = gl.vr.getController(context.draggingController)
      let object3d = scene.__interaction.find(o => o.userData.id === context.selection)

      let canSnap = useStoreApi.getState().canSnap

      let shouldMoveWithCursor =
        (object3d.userData.type == 'character') || canSnap

      if (shouldMoveWithCursor) {
        // TODO worldscale
        let worldScale = 1

        // update position via cursor
        const cursor = controller.getObjectByName('cursor')
        const wp = cursor.getWorldPosition(new THREE.Vector3())
        wp.sub(controller.userData.selectOffset)

        // constrain object rotation?
        // object3d.rotation.y = ???
        object3d.position.copy(wp).multiplyScalar(1 / worldScale)
      }
    }

    if (mode == 'rotate_bone') {
      let controller = gl.vr.getController(context.draggingController)
      let selectedBone = getSelectedBone(store.getState())

      // find the bone
      let bone = scene.getObjectByProperty('uuid', selectedBone)

      let {
        startingDeviceOffset,
        startingObjectOffset,
        startingObjectQuaternion
      } = useStoreApi.getState().boneRotationMemento

      let currControllerRot = new THREE.Matrix4().extractRotation(controller.matrixWorld)
      let deviceQuaternion = new THREE.Quaternion().setFromRotationMatrix(currControllerRot)

      let objectQuaternion = applyDeviceQuaternion({
        parent: bone.parent,

        startingDeviceOffset,
        startingObjectOffset,
        startingObjectQuaternion,

        deviceQuaternion,

        camera,
        useCameraOffset: true
      })

      bone.quaternion.copy(objectQuaternion.normalize())
    }
  }, false, [set, controllers])

  useMemo(() => {
    // TODO why is this memo called multiple times?
    console.log('useInteractionManager')
  }, [])

  const interactionService = useMemo(() => {
    const interactionService = interpret(
      interactionMachine
    ).onEvent(e => {
      //
    }).onTransition((state, event) => {
      const { value } = state

      log(`${event.type} -> ${value}`)
    })

    interactionService.start()

    return interactionService
  }, [])

  interactionMachine.options.actions = {
    ...interactionMachine.options.actions,

    // TODO base hide/show on context and remove teleportMode and teleportTargetValid entirely
    onDragTeleportStart: (context, event) => {
      log('-- onDragTeleportStart')
      setTeleportMode(true)
      // the target position value will be old until the next gl render
      // so consider teleportTargetValid to be false, to hide the mesh, until then
      set(state => ({ ...state, teleportTargetValid: false }))
    },
    onDragTeleportEnd: (context, event) => {
      log('-- onDragTeleportEnd')
      setTeleportMode(false)
      set(state => ({ ...state, teleportTargetValid: false }))
    },
    onTeleport: (context, event) => {
      log('-- teleport')
      // TODO adjust by worldScale
      // TODO reset worldScale after teleport
      if (teleportTargetValid) {
        let pos = useStoreApi.getState().teleportTargetPos
        teleport(pos[0], 0, pos[2], null)
        // setTeleportMode(false)
      }
    },

    onSelected: (context, event) => {
      log('-- onSelected')

      let controller = event.controller
      let { object, distance, point } = event.intersection

      controller.userData.selectOffset = getSelectOffset(controller, object, distance, point)

      dispatch(selectObject(context.selection))
    },

    onSelectNone: (context, event) => {
      let controller = event.controller
      log('-- onSelectNone', controller)
      controller.userData.selectOffset = null

      dispatch(selectObject(null))

      BonesHelper.getInstance().resetSelection()
    },

    onDragObjectEntry: (context, event) => {
      let controller = gl.vr.getController(context.draggingController)
      let object = event.intersection.object

      if (object.userData.type != 'character') {
        let worldScale = 1 // TODO

        object.scale.multiplyScalar(worldScale)
        controller.attach(object)
        object.updateMatrixWorld(true)
      }

      // TODO soundBeam
      // soundBeam.current.play()
    },
    onDragObjectExit: (context, event) => {
      let controller = gl.vr.getController(context.draggingController)
      let object = scene.__interaction.find(o => o.userData.id === context.selection)

      // TODO worldscale
      let root = scene

      // TODO soundBeam
      // soundBeam.current.stop()

      if (object.parent != root) {
        root.attach(object)
        object.updateMatrixWorld()
      }

      let rotation = object.userData.type == 'character'
        ? object.rotation.y
        : { x: object.rotation.x, y: object.rotation.y, z: object.rotation.z }
      dispatch(updateObject(context.selection, {
        x: object.position.x,
        y: object.position.z,
        z: object.position.y,
        rotation
      }))
    },
    onSnapStart: (context, event) => {
      let controller = gl.vr.getController(context.draggingController)
      let object = scene.__interaction.find(o => o.userData.id === context.selection)

      // TODO worldScale
      let worldScale = 1
      let root = scene

      controller.attach(object)
      object.updateMatrixWorld()
      snapObjectRotation(object, controller, worldScale)
      root.add(object)

      let intersections = getControllerIntersections(controller, [object])
      let { distance, point } = intersections[0]

      controller.userData.selectOffset = getSelectOffset(controller, object, distance, point)
      set(state => { state.canSnap = true })
    },
    onSnapEnd: (context, event) => {
      let controller = gl.vr.getController(context.draggingController)
      let object = scene.__interaction.find(o => o.userData.id === context.selection)

      // TODO worldScale
      // let worldScale = 1
      // let root = scene
      // object.scale.set(1, 1, 1)
      // root.add(object)
      // object.position.multiplyScalar(1 / worldScale)

      controller.attach(object)
      controller.userData.selectOffset = null

      set(state => { state.canSnap = false })
    },

    moveAndRotateCamera: (context, event) => {
      onMoveCamera(event)
      onRotateCamera(event)
    },

    moveAndRotateObject: (context, event) => {
      let controller = gl.vr.getController(context.draggingController)
      let object = scene.__interaction.find(o => o.userData.id === context.selection)

      // TODO worldScale
      let worldScale = 1

      let canSnap = useStoreApi.getState().canSnap
      let shouldMoveWithCursor =
        (object.userData.type == 'character') || canSnap

      let target = shouldMoveWithCursor
        ? controller.getObjectByName('cursor')
        : object

      moveObjectZ(target, event, worldScale)
      rotateObjectY(object, event, controller)
    },


    onRotateBoneEntry: (context, event) => {
      let controller = event.controller
      let bone = event.intersection.bone

      useStoreApi.setState({
        boneRotationMemento: getRotationMemento(controller, bone)
      })

      // select by UUID, like shot generator does
      dispatch(selectBone(bone.uuid))
      BonesHelper.getInstance().selectBone(bone)
    },
    onRotateBoneExit: (context, event) => {
      useStoreApi.setState({
        boneRotationMemento: {}
      })

      let selectedBone = getSelectedBone(store.getState())
      let bone = scene.getObjectByProperty('uuid', selectedBone)

      let parent
      bone.traverseAncestors(ancestor => {
        if (parent == null && ancestor.userData.type == 'character') {
          parent = ancestor
        }
      })

      let rotation = new THREE.Euler()
      rotation.setFromQuaternion(bone.quaternion.clone().normalize(), 'XYZ')

      let id = parent.userData.id
      let name = bone.name

      // TODO wrap in an undo group
      dispatch(
        updateCharacterSkeleton({
          id,
          name,
          rotation: {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z
          }
        })
      )
      dispatch(selectBone(null))
      BonesHelper.getInstance().resetSelection()
    }
  }

  // StateNode.withConfig doesn't accept services until xstate 4.6.7
  interactionMachine.options.services = {
    ...interactionMachine.options.services,

    // example: (context, event) => new Promise(resolve => {
    //   console.log('an example service')
    //   resolve()
    // }),
  }
}

module.exports = {
  useStore,
  useStoreApi,
  useInteractionsManager
}
