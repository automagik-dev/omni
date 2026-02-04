# AutomationMetrics


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**running** | **bool** | Engine running | 
**total_automations** | **int** | Total automations | 
**enabled_automations** | **int** | Enabled automations | 
**events_processed** | **int** | Events processed | 
**actions_executed** | **int** | Actions executed | 
**failed_actions** | **int** | Failed actions | 

## Example

```python
from omni_generated.models.automation_metrics import AutomationMetrics

# TODO update the JSON string below
json = "{}"
# create an instance of AutomationMetrics from a JSON string
automation_metrics_instance = AutomationMetrics.from_json(json)
# print the JSON string representation of the object
print(AutomationMetrics.to_json())

# convert the object into a dict
automation_metrics_dict = automation_metrics_instance.to_dict()
# create an instance of AutomationMetrics from a dict
automation_metrics_from_dict = AutomationMetrics.from_dict(automation_metrics_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


