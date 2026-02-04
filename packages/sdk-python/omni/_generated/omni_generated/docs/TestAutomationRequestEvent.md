# TestAutomationRequestEvent


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**type** | **str** | Event type | 
**payload** | **Dict[str, Optional[object]]** | Event payload | 

## Example

```python
from omni_generated.models.test_automation_request_event import TestAutomationRequestEvent

# TODO update the JSON string below
json = "{}"
# create an instance of TestAutomationRequestEvent from a JSON string
test_automation_request_event_instance = TestAutomationRequestEvent.from_json(json)
# print the JSON string representation of the object
print(TestAutomationRequestEvent.to_json())

# convert the object into a dict
test_automation_request_event_dict = test_automation_request_event_instance.to_dict()
# create an instance of TestAutomationRequestEvent from a dict
test_automation_request_event_from_dict = TestAutomationRequestEvent.from_dict(test_automation_request_event_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


