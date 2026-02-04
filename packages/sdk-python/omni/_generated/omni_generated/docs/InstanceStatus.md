# InstanceStatus


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**instance_id** | **UUID** | Instance UUID | 
**state** | **str** | Connection state | 
**is_connected** | **bool** | Whether instance is connected | 
**connected_at** | **datetime** | When connected | 
**profile_name** | **str** | Profile name | 
**profile_pic_url** | **str** | Profile picture URL | 
**owner_identifier** | **str** | Owner identifier | 
**message** | **str** | Status message | [optional] 

## Example

```python
from omni_generated.models.instance_status import InstanceStatus

# TODO update the JSON string below
json = "{}"
# create an instance of InstanceStatus from a JSON string
instance_status_instance = InstanceStatus.from_json(json)
# print the JSON string representation of the object
print(InstanceStatus.to_json())

# convert the object into a dict
instance_status_dict = instance_status_instance.to_dict()
# create an instance of InstanceStatus from a dict
instance_status_from_dict = InstanceStatus.from_dict(instance_status_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


