const Pickable = require("./Pickable");
class XRPickableObjectContainer extends Pickable
{
    constructor(sceneObject, idPool)
    {
        super(sceneObject);
        this.sceneMeshes = [];
        this.pickingMaterials = [];
        this.pickingMeshes = [];
        this.getMeshesFromSceneObject();
        this.isContainer = true;
        this.listOfChangedObjects = [];
        this.idPool = idPool;
    }

    getMeshesFromSceneObject()
    {
        this.sceneObject.traverse(sceneMesh => 
        {
            if(sceneMesh.type === "Mesh")
            {
                this.sceneMeshes.push(sceneMesh);
            }
        });
    }

    initialize(id)
    {
        this.node.type = this.sceneObject.userData.type;
        this.node.pickerId = id;
        for(let i = 0, n = this.sceneMeshes.length; i < n; i++)
        {
            id = this.idPool.getAvaibleId();
            let sceneMesh = this.sceneMeshes[i];
            super.initialize(id);
            this.pickingMaterials.push(this.pickingMaterial);
            this.pickingMesh = new THREE.Mesh(sceneMesh.geometry, this.pickingMaterial);
            this.node.add(this.pickingMesh);
            this.pickingMesh.pickerId = id;
            this.pickingMeshes.push(this.pickingMesh);
        }
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
        for(let i = 0, n = this.sceneMeshes.length; i < n; i++)
        {
            let sceneMesh = this.sceneMeshes[i];
            let pickingMesh = this.pickingMeshes[i];
            if(!sceneMesh)
            {
                this.node.remove(pickingMesh);
                delete this.pickingMeshes[i];
                delete this.pickingMaterial[i];
                delete this.sceneMeshes[i];
                n = this.sceneMeshes.length;
                i--;
                continue;
            }
            pickingMesh.position.copy(sceneMesh.worldPosition());
            pickingMesh.quaternion.copy(sceneMesh.worldQuaternion());
            pickingMesh.scale.copy(sceneMesh.worldScale());
        }
    }

    isObjectAdded(object)
    {
        if(this.sceneMeshes.find(sceneMesh => sceneMesh.uuid === object.uuid))
        {
            return true;
        }
        return false;
    }

    isObjectChanged()
    {
        this.listOfChangedObjects = [];
        this.sceneObject.traverse(object => 
        {
            if(!this.isObjectAdded(object) && object.type === "Mesh" 
                && object.visible)
            {
                this.listOfChangedObjects.push(object);
            }
        })
        if(this.listOfChangedObjects.length === 0)
        {
            return false;
        }
        else
        {
            return true;
        }
    }

    applyObjectChanges()
    {
        let id = 0;
        for(let i = 0, n = this.listOfChangedObjects.length; i < n; i++)
        {
            id = this.idPool.getAvaibleId();
            let sceneMesh = this.listOfChangedObjects[i];
            super.initialize(id);
            this.pickingMaterials.push(this.pickingMaterial);
            this.pickingMesh = new THREE.Mesh(sceneMesh.geometry, this.pickingMaterial);
            this.node.add(this.pickingMesh);
            this.changedIds = [];
            this.pickingMeshes.push(this.pickingMesh);
            this.sceneMeshes.push(sceneMesh);
            this.listOfChangedObjects[i] = {pickingMesh: this.pickingMesh, sceneMesh: this.sceneMesh};
        }
    }
}
module.exports = XRPickableObjectContainer;
