# RetryDeadLetter200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**success** | **bool** |  | 
**dead_letter_id** | **UUID** |  | [optional] 
**error** | **str** |  | [optional] 

## Example

```python
from omni_generated.models.retry_dead_letter200_response import RetryDeadLetter200Response

# TODO update the JSON string below
json = "{}"
# create an instance of RetryDeadLetter200Response from a JSON string
retry_dead_letter200_response_instance = RetryDeadLetter200Response.from_json(json)
# print the JSON string representation of the object
print(RetryDeadLetter200Response.to_json())

# convert the object into a dict
retry_dead_letter200_response_dict = retry_dead_letter200_response_instance.to_dict()
# create an instance of RetryDeadLetter200Response from a dict
retry_dead_letter200_response_from_dict = RetryDeadLetter200Response.from_dict(retry_dead_letter200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


