# GetAutomationMetrics200Response


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
from omni_generated.models.get_automation_metrics200_response import GetAutomationMetrics200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetAutomationMetrics200Response from a JSON string
get_automation_metrics200_response_instance = GetAutomationMetrics200Response.from_json(json)
# print the JSON string representation of the object
print(GetAutomationMetrics200Response.to_json())

# convert the object into a dict
get_automation_metrics200_response_dict = get_automation_metrics200_response_instance.to_dict()
# create an instance of GetAutomationMetrics200Response from a dict
get_automation_metrics200_response_from_dict = GetAutomationMetrics200Response.from_dict(get_automation_metrics200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


