# CreateAutomationRequestDebounce

Debounce config

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**mode** | **str** |  | 
**delay_ms** | **int** |  | [optional] 
**min_ms** | **int** |  | [optional] 
**max_ms** | **int** |  | [optional] 
**base_delay_ms** | **int** |  | [optional] 
**max_wait_ms** | **int** |  | [optional] 
**extend_on_events** | **List[str]** |  | [optional] 

## Example

```python
from omni_generated.models.create_automation_request_debounce import CreateAutomationRequestDebounce

# TODO update the JSON string below
json = "{}"
# create an instance of CreateAutomationRequestDebounce from a JSON string
create_automation_request_debounce_instance = CreateAutomationRequestDebounce.from_json(json)
# print the JSON string representation of the object
print(CreateAutomationRequestDebounce.to_json())

# convert the object into a dict
create_automation_request_debounce_dict = create_automation_request_debounce_instance.to_dict()
# create an instance of CreateAutomationRequestDebounce from a dict
create_automation_request_debounce_from_dict = CreateAutomationRequestDebounce.from_dict(create_automation_request_debounce_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


