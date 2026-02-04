# AutomationLog


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
from omni_generated.models.automation_log import AutomationLog

# TODO update the JSON string below
json = "{}"
# create an instance of AutomationLog from a JSON string
automation_log_instance = AutomationLog.from_json(json)
# print the JSON string representation of the object
print(AutomationLog.to_json())

# convert the object into a dict
automation_log_dict = automation_log_instance.to_dict()
# create an instance of AutomationLog from a dict
automation_log_from_dict = AutomationLog.from_dict(automation_log_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


