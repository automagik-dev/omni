# GetPerson200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | [**SearchPersons200ResponseItemsInner**](SearchPersons200ResponseItemsInner.md) |  | 

## Example

```python
from omni_generated.models.get_person200_response import GetPerson200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetPerson200Response from a JSON string
get_person200_response_instance = GetPerson200Response.from_json(json)
# print the JSON string representation of the object
print(GetPerson200Response.to_json())

# convert the object into a dict
get_person200_response_dict = get_person200_response_instance.to_dict()
# create an instance of GetPerson200Response from a dict
get_person200_response_from_dict = GetPerson200Response.from_dict(get_person200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


