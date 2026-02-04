# TestAutomation200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**matched** | **bool** |  | 
**condition_results** | [**List[TestAutomation200ResponseConditionResultsInner]**](TestAutomation200ResponseConditionResultsInner.md) |  | [optional] 
**would_execute** | [**List[ListAutomations200ResponseItemsInnerActionsInner]**](ListAutomations200ResponseItemsInnerActionsInner.md) |  | [optional] 

## Example

```python
from omni_generated.models.test_automation200_response import TestAutomation200Response

# TODO update the JSON string below
json = "{}"
# create an instance of TestAutomation200Response from a JSON string
test_automation200_response_instance = TestAutomation200Response.from_json(json)
# print the JSON string representation of the object
print(TestAutomation200Response.to_json())

# convert the object into a dict
test_automation200_response_dict = test_automation200_response_instance.to_dict()
# create an instance of TestAutomation200Response from a dict
test_automation200_response_from_dict = TestAutomation200Response.from_dict(test_automation200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


