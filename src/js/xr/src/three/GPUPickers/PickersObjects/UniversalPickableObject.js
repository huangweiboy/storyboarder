const Pickable = require("./Pickable");
class UniversalPickableObject extends Pickable
{
    constructor(sceneObject)
    {
        super(sceneObject);
        this.getMeshFromSceneObject();
    }
    
    getMeshFromSceneObject()
    {
        this.sceneMesh = this.sceneObject.children.find(child => child.type === "Mesh")
    }

    initialize(id)
    {
        super.initialize(id);
        this.pickingMesh = new THREE.Mesh(this.sceneMesh.geometry, this.pickingMaterial);
        this.node.type = "object";
        this.node.add(this.pickingMesh);
        this.node.pickerId = id;
        this.pickingMesh.pickerId = id;
        //ToDO(): Find a better way to remove deleted objects
        this.needsRemoval = false;
    }

    update()
    {
        if(this.isSceneObjectRemoved())
        {
            this.needsRemoval = true;
            return;
        }
        this.node.position.copy(this.sceneMesh.worldPosition());
        this.node.quaternion.copy(this.sceneMesh.worldQuaternion());
        this.node.scale.copy(this.sceneMesh.worldScale());
        this.node.updateMatrixWorld();
    }
    
    isObjectChanged()
    {
        if(this.sceneObject && !this.sceneMesh.parent && this.sceneObject.children.length !== 0)
        {
            return true;
        }
        return false;
    }

    applyObjectChanges()
    {
        this.sceneMesh = this.sceneObject.children.find(child => child.type === "Mesh");
        if(!this.sceneMesh)
        {
            this.needsRemoval = true;
        }
        this.pickingMesh.geometry.dispose();
        this.pickingMesh.geometry = this.sceneMesh.geometry;
        this.pickingMesh.name = this.sceneMesh.name;
        this.pickingMesh.needsUpdate = true;
    }
    
}
module.exports = UniversalPickableObject;
