# GetHealth200ResponseChecksDatabase


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **str** | Check status | 
**latency** | **float** | Latency in milliseconds | [optional] 
**error** | **str** | Error message if status is error | [optional] 
**details** | **Dict[str, Optional[object]]** | Additional details | [optional] 

## Example

```python
from omni_generated.models.get_health200_response_checks_database import GetHealth200ResponseChecksDatabase

# TODO update the JSON string below
json = "{}"
# create an instance of GetHealth200ResponseChecksDatabase from a JSON string
get_health200_response_checks_database_instance = GetHealth200ResponseChecksDatabase.from_json(json)
# print the JSON string representation of the object
print(GetHealth200ResponseChecksDatabase.to_json())

# convert the object into a dict
get_health200_response_checks_database_dict = get_health200_response_checks_database_instance.to_dict()
# create an instance of GetHealth200ResponseChecksDatabase from a dict
get_health200_response_checks_database_from_dict = GetHealth200ResponseChecksDatabase.from_dict(get_health200_response_checks_database_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


