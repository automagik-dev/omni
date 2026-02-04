# ListPayloadConfigs200ResponseItemsInner


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
from omni_generated.models.list_payload_configs200_response_items_inner import ListPayloadConfigs200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ListPayloadConfigs200ResponseItemsInner from a JSON string
list_payload_configs200_response_items_inner_instance = ListPayloadConfigs200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(ListPayloadConfigs200ResponseItemsInner.to_json())

# convert the object into a dict
list_payload_configs200_response_items_inner_dict = list_payload_configs200_response_items_inner_instance.to_dict()
# create an instance of ListPayloadConfigs200ResponseItemsInner from a dict
list_payload_configs200_response_items_inner_from_dict = ListPayloadConfigs200ResponseItemsInner.from_dict(list_payload_configs200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


