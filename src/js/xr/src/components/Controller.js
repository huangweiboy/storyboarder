const THREE = require('three')
const { useMemo } = React = require('react')

const useGltf = require('../hooks/use-gltf')

const Controller = () => {
  const gltf = useGltf('/data/system/xr/sgcontroller.glb')

  const mesh = useMemo(
    () => {
      let meshes = []
      let child = gltf.scene.children[0].clone()
      let material = child.material.clone()

      let map = material.map
      let alphaMap = material.metalnessMap
      child.material = new THREE.MeshBasicMaterial({
        map,
        alphaMap,
        transparent: true
      })

      return child
    },
    [gltf]
  )

  return mesh
    ? <group>
      <primitive object={mesh} />
      <mesh name={'cursor'} visible={true/*false*/}>
        <boxBufferGeometry attach="geometry" args={[0.1, 0.1, 0.1]} />
        <meshBasicMaterial attach="material" />
      </mesh>
    </group>
    : null
}

module.exports = Controller
