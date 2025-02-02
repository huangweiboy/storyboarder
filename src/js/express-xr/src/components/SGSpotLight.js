const { useUpdate } = require('react-three-fiber')
const { useEffect, useRef } = (React = require('react'))
const { updateObjectHighlight } = require('../utils/xrHelperFuncs')

const SGSpotLight = ({ isSelected, ...props }) => {
  const light = useRef(null)
  const box_light_mesh = useRef(null)

  const light_spot = useUpdate(
    self => {
      self.target.position.set(0, 0, props.intensity)
      self.add(self.target)
    },
    [props.intensity]
  )

  useEffect(() => {
    if (light.current) {
      light.current.light = light_spot
      light.current.hitter = box_light_mesh
    }
  })

  useUpdate(() => {
    if (light.current) {
      light.current.rotation.x = 0
      light.current.rotation.z = 0
      light.current.rotation.y = props.rotation || 0
      light.current.rotateX(props.tilt || 0)
      light.current.rotateZ(props.roll || 0)

      light.current.light.current.target.position.set(0, 0, props.distance)
    }
  }, [props.rotation, props.tilt, props.roll, props.distance])

  useEffect(() => {
    if (!light.current) return
    if (isSelected) updateObjectHighlight(light.current, 0.15)
    else updateObjectHighlight(light.current, 0)
  }, [isSelected])

  return (
    <group
      ref={light}
      visible={props.visible}
      userData={{
        id: props.id,
        displayName: props.name || props.displayName,
        type: props.type,
        forPanel: { intensity: props.intensity, angle: props.angle }
      }}
      position={[props.x, props.z, props.y]}
    >
      <group>
        <spotLight
          ref={light_spot}
          color={0xffffff}
          intensity={props.intensity}
          position={[0, 0, 0]}
          rotation={[Math.PI / 2, 0, 0]}
          angle={props.angle}
          distance={props.distance}
          penumbra={props.penumbra}
          decay={props.decay}
        />
        <mesh ref={box_light_mesh} name="hitter_light" userData={{ type: 'hitter_light' }}>
          <sphereBufferGeometry attach="geometry" args={[0.125]} />
          <meshLambertMaterial attach="material" visible={false} />
        </mesh>
        <mesh>
          <cylinderBufferGeometry attach="geometry" args={[0.0, 0.05, 0.14]} />
          <meshLambertMaterial attach="material" color={0xffff66} />
          {props.children}
        </mesh>
      </group>
    </group>
  )
}

module.exports = SGSpotLight
