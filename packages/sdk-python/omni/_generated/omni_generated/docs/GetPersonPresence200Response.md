# GetPersonPresence200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**GetPersonPresence200ResponseData**](GetPersonPresence200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.get_person_presence200_response import GetPersonPresence200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetPersonPresence200Response from a JSON string
get_person_presence200_response_instance = GetPersonPresence200Response.from_json(json)
# print the JSON string representation of the object
print(GetPersonPresence200Response.to_json())

# convert the object into a dict
get_person_presence200_response_dict = get_person_presence200_response_instance.to_dict()
# create an instance of GetPersonPresence200Response from a dict
get_person_presence200_response_from_dict = GetPersonPresence200Response.from_dict(get_person_presence200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


