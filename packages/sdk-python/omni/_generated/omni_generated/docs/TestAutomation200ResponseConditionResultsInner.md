# TestAutomation200ResponseConditionResultsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**condition** | [**ListAutomations200ResponseItemsInnerTriggerConditionsInner**](ListAutomations200ResponseItemsInnerTriggerConditionsInner.md) |  | 
**passed** | **bool** |  | 

## Example

```python
from omni_generated.models.test_automation200_response_condition_results_inner import TestAutomation200ResponseConditionResultsInner

# TODO update the JSON string below
json = "{}"
# create an instance of TestAutomation200ResponseConditionResultsInner from a JSON string
test_automation200_response_condition_results_inner_instance = TestAutomation200ResponseConditionResultsInner.from_json(json)
# print the JSON string representation of the object
print(TestAutomation200ResponseConditionResultsInner.to_json())

# convert the object into a dict
test_automation200_response_condition_results_inner_dict = test_automation200_response_condition_results_inner_instance.to_dict()
# create an instance of TestAutomation200ResponseConditionResultsInner from a dict
test_automation200_response_condition_results_inner_from_dict = TestAutomation200ResponseConditionResultsInner.from_dict(test_automation200_response_condition_results_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


