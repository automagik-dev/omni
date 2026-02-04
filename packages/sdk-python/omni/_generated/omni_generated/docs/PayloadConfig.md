# PayloadConfig


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**event_type** | **str** | Event type pattern | 
**store_webhook_raw** | **bool** | Store webhook raw | 
**store_agent_request** | **bool** | Store agent request | 
**store_agent_response** | **bool** | Store agent response | 
**store_channel_send** | **bool** | Store channel send | 
**store_error** | **bool** | Store errors | 
**retention_days** | **int** | Retention in days | 

## Example

```python
from omni_generated.models.payload_config import PayloadConfig

# TODO update the JSON string below
json = "{}"
# create an instance of PayloadConfig from a JSON string
payload_config_instance = PayloadConfig.from_json(json)
# print the JSON string representation of the object
print(PayloadConfig.to_json())

# convert the object into a dict
payload_config_dict = payload_config_instance.to_dict()
# create an instance of PayloadConfig from a dict
payload_config_from_dict = PayloadConfig.from_dict(payload_config_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


