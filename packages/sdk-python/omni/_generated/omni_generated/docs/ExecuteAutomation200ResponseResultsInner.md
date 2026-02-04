# ExecuteAutomation200ResponseResultsInner


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**action** | **str** |  | 
**status** | **str** |  | 
**result** | **object** |  | [optional] 
**error** | **str** |  | [optional] 
**duration_ms** | **int** |  | 

## Example

```python
from omni_generated.models.execute_automation200_response_results_inner import ExecuteAutomation200ResponseResultsInner

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteAutomation200ResponseResultsInner from a JSON string
execute_automation200_response_results_inner_instance = ExecuteAutomation200ResponseResultsInner.from_json(json)
# print the JSON string representation of the object
print(ExecuteAutomation200ResponseResultsInner.to_json())

# convert the object into a dict
execute_automation200_response_results_inner_dict = execute_automation200_response_results_inner_instance.to_dict()
# create an instance of ExecuteAutomation200ResponseResultsInner from a dict
execute_automation200_response_results_inner_from_dict = ExecuteAutomation200ResponseResultsInner.from_dict(execute_automation200_response_results_inner_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


