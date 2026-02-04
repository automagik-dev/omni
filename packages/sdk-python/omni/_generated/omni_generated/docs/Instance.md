# Instance


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Instance UUID | 
**name** | **str** | Instance name | 
**channel** | **str** | Channel type | 
**is_active** | **bool** | Whether instance is active | 
**is_default** | **bool** | Whether this is the default instance for channel | 
**profile_name** | **str** | Connected profile name | 
**profile_pic_url** | **str** | Profile picture URL | 
**owner_identifier** | **str** | Owner identifier | 
**agent_provider_id** | **UUID** | Agent provider UUID | 
**agent_id** | **str** | Agent ID | 
**agent_timeout** | **float** | Agent timeout in seconds | 
**agent_stream_mode** | **bool** | Whether streaming is enabled | 
**created_at** | **datetime** | Creation timestamp | 
**updated_at** | **datetime** | Last update timestamp | 

## Example

```python
from omni_generated.models.instance import Instance

# TODO update the JSON string below
json = "{}"
# create an instance of Instance from a JSON string
instance_instance = Instance.from_json(json)
# print the JSON string representation of the object
print(Instance.to_json())

# convert the object into a dict
instance_dict = instance_instance.to_dict()
# create an instance of Instance from a dict
instance_from_dict = Instance.from_dict(instance_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


