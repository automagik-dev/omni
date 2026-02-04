# CreateAutomationRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Name | 
**description** | **str** | Description | [optional] 
**trigger_event_type** | **str** | Trigger event type | 
**trigger_conditions** | [**List[ListAutomations200ResponseItemsInnerTriggerConditionsInner]**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) | Conditions | [optional] 
**condition_logic** | **str** | Condition logic: \&quot;and\&quot; (all must match) or \&quot;or\&quot; (any must match) | [optional] [default to 'and']
**actions** | [**List[ListAutomations200ResponseItemsInnerActionsInner]**](ListAutomations200ResponseItemsInnerActionsInner.md) | Actions | 
**debounce** | [**CreateAutomationRequestDebounce**](CreateAutomationRequestDebounce.md) |  | [optional] 
**enabled** | **bool** | Whether enabled | [optional] [default to True]
**priority** | **int** | Priority | [optional] [default to 0]

## Example

```python
from omni_generated.models.create_automation_request import CreateAutomationRequest

# TODO update the JSON string below
json = "{}"
# create an instance of CreateAutomationRequest from a JSON string
create_automation_request_instance = CreateAutomationRequest.from_json(json)
# print the JSON string representation of the object
print(CreateAutomationRequest.to_json())

# convert the object into a dict
create_automation_request_dict = create_automation_request_instance.to_dict()
# create an instance of CreateAutomationRequest from a dict
create_automation_request_from_dict = CreateAutomationRequest.from_dict(create_automation_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


