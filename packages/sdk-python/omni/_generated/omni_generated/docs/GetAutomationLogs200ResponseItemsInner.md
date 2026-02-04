# GetAutomationLogs200ResponseItemsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **UUID** | Log UUID | 
**automation_id** | **UUID** | Automation UUID | 
**event_id** | **UUID** | Event UUID | 
**event_type** | **str** | Event type | 
**status** | **str** | Execution status | 
**error** | **str** | Error message | 
**executed_at** | **datetime** | Execution timestamp | 
**duration_ms** | **int** | Duration (ms) | 

## Example

```python
from omni_generated.models.get_automation_logs200_response_items_inner import GetAutomationLogs200ResponseItemsInner

# TODO update the JSON string below
json = "{}"
# create an instance of GetAutomationLogs200ResponseItemsInner from a JSON string
get_automation_logs200_response_items_inner_instance = GetAutomationLogs200ResponseItemsInner.from_json(json)
# print the JSON string representation of the object
print(GetAutomationLogs200ResponseItemsInner.to_json())

# convert the object into a dict
get_automation_logs200_response_items_inner_dict = get_automation_logs200_response_items_inner_instance.to_dict()
# create an instance of GetAutomationLogs200ResponseItemsInner from a dict
get_automation_logs200_response_items_inner_from_dict = GetAutomationLogs200ResponseItemsInner.from_dict(get_automation_logs200_response_items_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


