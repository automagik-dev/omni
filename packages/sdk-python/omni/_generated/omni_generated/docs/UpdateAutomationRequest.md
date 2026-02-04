# UpdateAutomationRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**name** | **str** | Name | [optional] 
**description** | **str** | Description | [optional] 
**trigger_event_type** | **str** | Trigger event type | [optional] 
**trigger_conditions** | [**List[ListAutomations200ResponseItemsInnerTriggerConditionsInner]**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) | Conditions | [optional] 
**condition_logic** | **str** | Condition logic: \&quot;and\&quot; (all must match) or \&quot;or\&quot; (any must match) | [optional] [default to 'and']
**actions** | [**List[ListAutomations200ResponseItemsInnerActionsInner]**](ListAutomations200ResponseItemsInnerActionsInner.md) | Actions | [optional] 
**debounce** | [**CreateAutomationRequestDebounce**](CreateAutomationRequestDebounce.md) |  | [optional] 
**enabled** | **bool** | Whether enabled | [optional] [default to True]
**priority** | **int** | Priority | [optional] [default to 0]

## Example

```python
from omni_generated.models.update_automation_request import UpdateAutomationRequest

# TODO update the JSON string below
json = "{}"
# create an instance of UpdateAutomationRequest from a JSON string
update_automation_request_instance = UpdateAutomationRequest.from_json(json)
# print the JSON string representation of the object
print(UpdateAutomationRequest.to_json())

# convert the object into a dict
update_automation_request_dict = update_automation_request_instance.to_dict()
# create an instance of UpdateAutomationRequest from a dict
update_automation_request_from_dict = UpdateAutomationRequest.from_dict(update_automation_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


