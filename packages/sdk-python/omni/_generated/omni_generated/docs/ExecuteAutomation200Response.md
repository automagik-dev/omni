# ExecuteAutomation200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**automation_id** | **UUID** |  | 
**triggered** | **bool** | Whether the automation was triggered (event type matched) | 
**results** | [**List[ExecuteAutomation200ResponseResultsInner]**](ExecuteAutomation200ResponseResultsInner.md) | Results of each action execution | 

## Example

```python
from omni_generated.models.execute_automation200_response import ExecuteAutomation200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ExecuteAutomation200Response from a JSON string
execute_automation200_response_instance = ExecuteAutomation200Response.from_json(json)
# print the JSON string representation of the object
print(ExecuteAutomation200Response.to_json())

# convert the object into a dict
execute_automation200_response_dict = execute_automation200_response_instance.to_dict()
# create an instance of ExecuteAutomation200Response from a dict
execute_automation200_response_from_dict = ExecuteAutomation200Response.from_dict(execute_automation200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


