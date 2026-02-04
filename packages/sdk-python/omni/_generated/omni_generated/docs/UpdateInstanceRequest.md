# UpdateInstanceRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Unique name for the instance | [optional] 
**channel** | **str** | Channel type | [optional] 
**agent_provider_id** | **UUID** | Reference to agent provider | [optional] 
**agent_id** | **str** | Agent ID within the provider | [optional] [default to 'default']
**agent_timeout** | **int** | Agent timeout in seconds | [optional] [default to 60]
**agent_stream_mode** | **bool** | Enable streaming responses | [optional] [default to False]
**is_default** | **bool** | Set as default instance for channel | [optional] [default to False]
**token** | **str** | Bot token for Discord instances | [optional] 

## Example

```python
from omni_generated.models.update_instance_request import UpdateInstanceRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateInstanceRequest from a JSON string
update_instance_request_instance = UpdateInstanceRequest.from_json(json)
# print the JSON string representation of the object
print(UpdateInstanceRequest.to_json())

# convert the object into a dict
update_instance_request_dict = update_instance_request_instance.to_dict()
# create an instance of UpdateInstanceRequest from a dict
update_instance_request_from_dict = UpdateInstanceRequest.from_dict(update_instance_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


