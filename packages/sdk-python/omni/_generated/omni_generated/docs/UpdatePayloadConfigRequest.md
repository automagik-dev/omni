# UpdatePayloadConfigRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**store_webhook_raw** | **bool** | Store webhook raw | [optional] 
**store_agent_request** | **bool** | Store agent request | [optional] 
**store_agent_response** | **bool** | Store agent response | [optional] 
**store_channel_send** | **bool** | Store channel send | [optional] 
**store_error** | **bool** | Store errors | [optional] 
**retention_days** | **int** | Retention in days | [optional] 

## Example

```python
from omni_generated.models.update_payload_config_request import UpdatePayloadConfigRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdatePayloadConfigRequest from a JSON string
update_payload_config_request_instance = UpdatePayloadConfigRequest.from_json(json)
# print the JSON string representation of the object
print(UpdatePayloadConfigRequest.to_json())

# convert the object into a dict
update_payload_config_request_dict = update_payload_config_request_instance.to_dict()
# create an instance of UpdatePayloadConfigRequest from a dict
update_payload_config_request_from_dict = UpdatePayloadConfigRequest.from_dict(update_payload_config_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


